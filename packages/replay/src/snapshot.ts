import { ReplayNodeType, type SerializedNode } from '@web-monitor/types';
import { maskAttributes, maskString, shouldBlockElement, shouldMaskElement } from './mask';
import type { MaskContext } from './types';

/** 不入库的标签（脚本不录制，避免回放时执行；装饰性资源省略以控制体积） */
const SKIP_TAGS = new Set(['script', 'noscript', 'base', 'meta', 'template']);

/**
 * 节点 ID 注册表：录制端与播放端共用同一套 id 语义，
 * 增量变更通过 id 定位节点，这是回放能精确复现的前提。
 */
export class NodeRegistry {
  private idToNode = new Map<number, Node>();
  private nodeToId = new WeakMap<Node, number>();
  private nextId = 1;

  getId(node: Node): number {
    const existing = this.nodeToId.get(node);
    if (existing) return existing;
    const id = this.nextId++;
    this.nodeToId.set(node, id);
    this.idToNode.set(id, node);
    return id;
  }

  assign(node: Node): number {
    const id = this.nextId++;
    this.nodeToId.set(node, id);
    this.idToNode.set(id, node);
    return id;
  }

  getNode(id: number): Node | undefined {
    return this.idToNode.get(id);
  }

  clear(): void {
    this.idToNode.clear();
    this.nodeToId = new WeakMap<Node, number>();
    this.nextId = 1;
  }
}

/**
 * 序列化 DOM 节点（rrweb 兼容格式）。
 * 遮罩规则在此生效：命中遮罩的元素其文本与 value 全部替换为 ***。
 */
export function serializeNode(
  node: Node,
  registry: NodeRegistry,
  mask: MaskContext,
  parentMasked = false,
): SerializedNode | null {
  const nodeType = node.nodeType;

  if (nodeType === Node.DOCUMENT_NODE) {
    const id = registry.assign(node);
    const childNodes: SerializedNode[] = [];
    Array.from(node.childNodes).forEach((child) => {
      const serialized = serializeNode(child, registry, mask, parentMasked);
      if (serialized) childNodes.push(serialized);
    });
    return { type: ReplayNodeType.Document, id, childNodes };
  }

  if (nodeType === Node.DOCUMENT_TYPE_NODE) {
    const id = registry.assign(node);
    return {
      type: ReplayNodeType.DocumentType,
      id,
      tagName: (node as DocumentType).name,
      attributes: {
        publicId: (node as DocumentType).publicId || '',
        systemId: (node as DocumentType).systemId || '',
      },
    };
  }

  if (nodeType === Node.TEXT_NODE) {
    const id = registry.assign(node);
    let textContent = node.textContent || '';
    if (parentMasked || mask.maskAllText) textContent = maskString(textContent);
    return { type: ReplayNodeType.Text, id, textContent };
  }

  if (nodeType === Node.COMMENT_NODE) {
    const id = registry.assign(node);
    return { type: ReplayNodeType.Comment, id, textContent: node.textContent || '' };
  }

  if (nodeType !== Node.ELEMENT_NODE) {
    // CData 等少见类型统一按文本处理
    if (node.nodeType === 4) {
      const id = registry.assign(node);
      return { type: ReplayNodeType.Cdata, id, textContent: node.textContent || '' };
    }
    return null;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  if (SKIP_TAGS.has(tagName)) return null;

  const id = registry.assign(element);

  if (shouldBlockElement(element, mask)) {
    // 被忽略的元素只保留占位，不写入任何内容
    return {
      type: ReplayNodeType.Element,
      id,
      tagName,
      attributes: {},
      childNodes: [],
      needBlock: true,
    };
  }

  const masked = parentMasked || shouldMaskElement(element, mask);
  const isSVG = element.namespaceURI === 'http://www.w3.org/2000/svg';
  const attributes = maskAttributes(element, masked, []);
  if (masked && 'value' in element) {
    attributes.value = maskString(String((element as HTMLInputElement).value || ''));
  }

  const childNodes: SerializedNode[] = [];
  if (tagName !== 'iframe' && tagName !== 'canvas' && tagName !== 'video') {
    Array.from(element.childNodes).forEach((child) => {
      const serialized = serializeNode(child, registry, mask, masked);
      if (serialized) childNodes.push(serialized);
    });
  }

  return {
    type: ReplayNodeType.Element,
    id,
    tagName,
    attributes,
    childNodes,
    isSVG: isSVG || undefined,
  };
}

/** 序列化整个 document */
export function serializeDocument(doc: Document, registry: NodeRegistry, mask: MaskContext): SerializedNode {
  return serializeNode(doc, registry, mask) as SerializedNode;
}

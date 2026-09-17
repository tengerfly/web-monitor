import axios, { type AxiosRequestConfig } from 'axios';
import { message } from 'antd';

/**
 * 统一请求客户端。
 * 服务端响应结构固定为 { code, message, data }，这里在拦截器里拆包，
 * 业务层拿到的直接是 data，同时把业务错误统一抛出为 Error。
 */
const instance = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

instance.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) {
        const text = body.message || `请求失败（code=${body.code}）`;
        message.error(text);
        return Promise.reject(new Error(text));
      }
      return body.data;
    }
    return body;
  },
  (error) => {
    const text =
      error?.response?.data?.message || error?.message || '网络异常，请稍后重试';
    message.error(text);
    return Promise.reject(error);
  },
);

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  // 响应拦截器已把 { code, message, data } 拆包为 data，因此这里断言为业务类型
  const result = await instance.request(config);
  return result as unknown as T;
}

export const get = <T>(url: string, params?: Record<string, any>): Promise<T> =>
  request<T>({ url, method: 'GET', params });

export const post = <T>(url: string, data?: any, params?: Record<string, any>): Promise<T> =>
  request<T>({ url, method: 'POST', data, params });

export const put = <T>(url: string, data?: any): Promise<T> =>
  request<T>({ url, method: 'PUT', data });

export const patch = <T>(url: string, data?: any): Promise<T> =>
  request<T>({ url, method: 'PATCH', data });

export const del = <T>(url: string): Promise<T> => request<T>({ url, method: 'DELETE' });

export default instance;

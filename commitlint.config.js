// commitlint.config.js
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
      'type-enum': [ // 只允许指定类型
        2, // 错误级别：2（error），1（warning），0（off）
        'always', // 校验条件：always|never
        ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'revert']
      ],
      'subject-case': [ // 主题必须全小写
        2,
        'always',
        'lower-case'
      ],
      'subject-max-length': [ // 主题最长 72 字符
        2,
        'always',
        72
      ],
      'body-leading-blank': [ // 正文前需空一行
        2,
        'always'
      ],
      'footer-leading-blank': [ // 脚注前需空一行
        2,
        'always'
      ]
    }
  };
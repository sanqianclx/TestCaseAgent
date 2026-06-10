/**
 * Markdown 消息渲染组件
 *
 * 用 react-markdown + remark-gfm 渲染消息中的 Markdown，
 * 代码块通过 react-syntax-highlighter 高亮。
 *
 * 用于 Chat 页面、AI 消息气泡内的内容展示。
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Typography } from 'antd';

const { Text } = Typography;

/**
 * 语言别名归一化
 *
 * @param raw 原始语言标识
 * @returns 标准化后的 Prism 语言
 */
function normalizeLang(raw?: string): string {
  if (!raw) return 'text';
  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    py: 'python',
    python3: 'python',
    js: 'javascript',
    ts: 'typescript',
    'c++': 'cpp',
    'c#': 'csharp',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
  };
  return map[lower] || lower;
}

/**
 * Markdown 消息组件属性
 */
export interface MarkdownMessageProps {
  /** Markdown 文本 */
  content: string;
  /** 暗色模式（暂未用，预留） */
  dark?: boolean;
}

/**
 * Markdown 消息组件
 */
const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <div
      className="markdown-message"
      style={{
        fontSize: 14,
        lineHeight: 1.65,
        color: 'inherit',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...props }) => (
            <p
              {...props}
              style={{
                margin: '0 0 8px',
              }}
            />
          ),
          ul: ({ node, ...props }) => <ul {...props} style={{ margin: '4px 0 8px', paddingLeft: 20 }} />,
          ol: ({ node, ...props }) => <ol {...props} style={{ margin: '4px 0 8px', paddingLeft: 20 }} />,
          li: ({ node, ...props }) => <li {...props} style={{ margin: '2px 0' }} />,
          // 自定义代码块渲染
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  language={normalizeLang(match[1])}
                  style={oneLight}
                  PreTag="div"
                  showLineNumbers
                  customStyle={{
                    margin: '8px 0',
                    borderRadius: 6,
                    fontSize: 12.5,
                    maxHeight: 480,
                    padding: '10px 12px',
                  }}
                  {...(props as any)}
                >
                  {value}
                </SyntaxHighlighter>
              );
            }
            return (
              <code
                className={className}
                style={{
                  background: 'rgba(0,0,0,0.06)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: '0.92em',
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          // 链接默认新窗口打开
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          // 表格紧凑
          table: ({ node, ...props }) => (
            <table
              {...props}
              style={{
                borderCollapse: 'collapse',
                margin: '8px 0',
                fontSize: 13,
                width: '100%',
              }}
            />
          ),
          th: ({ node, ...props }) => (
            <th
              {...props}
              style={{
                border: '1px solid #d9d9d9',
                padding: '6px 10px',
                background: '#fafafa',
                textAlign: 'left',
              }}
            />
          ),
          td: ({ node, ...props }) => (
            <td {...props} style={{ border: '1px solid #d9d9d9', padding: '6px 10px' }} />
          ),
        }}
      >
        {content || ''}
      </ReactMarkdown>
      {/* 占位元素：避免内容为空时 collapse */}
      {!content && <Text type="secondary">…</Text>}
    </div>
  );
};

export default MarkdownMessage;

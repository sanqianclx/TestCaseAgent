/**
 * 通用代码查看器
 *
 * 支持两种用法：
 * 1. `<CodeViewer fileId={id} />` —— 调 /files/:id/content 拉取内容
 * 2. `<CodeViewer code="..." language="python" />` —— 直接传入代码
 *
 * 通过 react-syntax-highlighter 渲染高亮。
 */

import React, { useEffect, useState } from 'react';
import { Spin, Alert, Space, Select, Button, message } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import * as filesApi from '../../api/files';

const SUPPORTED_LANGS = [
  'python',
  'java',
  'cpp',
  'javascript',
  'typescript',
  'json',
  'bash',
  'sql',
  'yaml',
  'text',
];

/**
 * 属性
 */
export interface CodeViewerProps {
  /** 文件 ID（与 code 二选一） */
  fileId?: number;
  /** 直接传入的代码 */
  code?: string;
  /** 语言 */
  language?: string | null;
  /** 是否显示语言切换器（默认 true） */
  showLangSwitch?: boolean;
  /** 是否显示复制按钮（默认 true） */
  showCopy?: boolean;
  /** 最大高度 */
  maxHeight?: number;
}

/**
 * 通用代码查看器
 */
const CodeViewer: React.FC<CodeViewerProps> = ({
  fileId,
  code,
  language,
  showLangSwitch = true,
  showCopy = true,
  maxHeight = 480,
}) => {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>(code || '');
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<string>((language || 'text').toLowerCase());

  // 拉取文件内容
  useEffect(() => {
    if (code !== undefined) {
      setContent(code);
      return;
    }
    if (!fileId) {
      setContent('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    filesApi
      .getFileContent(fileId)
      .then((r) => {
        if (cancelled) return;
        setContent(r.content || '');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setErr(e?.message || '加载文件失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, code]);

  // 同步外部 language 变化
  useEffect(() => {
    if (language) setLang(language.toLowerCase());
  }, [language]);

  /**
   * 复制到剪贴板
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  };

  if (err) {
    return <Alert type="error" message="加载失败" description={err} showIcon />;
  }

  return (
    <div className="code-viewer">
      <Space style={{ marginBottom: 6, width: '100%', justifyContent: 'space-between' }}>
        {showLangSwitch ? (
          <Space size={6}>
            <span style={{ fontSize: 12, color: '#888' }}>语言</span>
            <Select
              size="small"
              value={lang}
              onChange={setLang}
              style={{ width: 130 }}
              options={SUPPORTED_LANGS.map((v) => ({ value: v, label: v }))}
            />
            {fileId && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  // 强制重读
                  setContent('');
                  setLoading(true);
                  filesApi
                    .getFileContent(fileId)
                    .then((r) => setContent(r.content || ''))
                    .catch((e) => setErr(e?.message || '加载失败'))
                    .finally(() => setLoading(false));
                }}
              />
            )}
          </Space>
        ) : (
          <span />
        )}
        {showCopy && (
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopy} disabled={!content}>
            复制
          </Button>
        )}
      </Space>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin tip="加载中..." />
        </div>
      ) : (
        <SyntaxHighlighter
          language={lang}
          style={oneLight}
          showLineNumbers
          customStyle={{
            margin: 0,
            borderRadius: 6,
            fontSize: 12.5,
            maxHeight,
            padding: '10px 12px',
          }}
        >
          {content || '(空)'}
        </SyntaxHighlighter>
      )}
    </div>
  );
};

export default CodeViewer;

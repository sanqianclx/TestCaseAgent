/**
 * 通用代码查看器
 *
 * 支持两种用法：
 * 1. `<CodeViewer fileId={id} />` —— 调 /files/:id/content 拉取内容
 * 2. `<CodeViewer code="..." language="python" />` —— 直接传入代码
 *
 * 通过 react-syntax-highlighter 渲染高亮。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Spin, Alert } from 'antd';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import * as filesApi from '../../api/files';
import * as sessionsApi from '../../api/sessions';

/**
 * 属性
 */
export interface CodeViewerProps {
  /** 文件 ID（与 code 二选一） */
  fileId?: number;
  /** 会话输出目录文件 */
  sessionOutputFile?: {
    sessionId: number;
    path: string;
  };
  /** 直接传入的代码 */
  code?: string;
  /** 语言 */
  language?: string | null;
  /** 最大高度 */
  maxHeight?: number;
}

/**
 * 通用代码查看器
 */
const CodeViewer: React.FC<CodeViewerProps> = ({
  fileId,
  sessionOutputFile,
  code,
  language,
  maxHeight = 480,
}) => {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>(code || '');
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<string>((language || 'text').toLowerCase());

  const loadContent = useCallback(() => {
    if (code !== undefined) {
      setContent(code);
      setErr(null);
      setLoading(false);
      return () => {};
    }
    if (!fileId && !sessionOutputFile) {
      setContent('');
      setErr(null);
      setLoading(false);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const request = fileId
      ? filesApi.getFileContent(fileId)
      : sessionsApi.getSessionOutputFileContent(sessionOutputFile!.sessionId, sessionOutputFile!.path);
    request
      .then((r: any) => {
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
  }, [code, fileId, sessionOutputFile]);

  // 拉取文件内容
  useEffect(() => loadContent(), [loadContent]);

  // 同步外部 language 变化
  useEffect(() => {
    if (language) setLang(language.toLowerCase());
  }, [language]);

  if (err) {
    return <Alert type="error" message="加载失败" description={err} showIcon />;
  }

  return (
    <div className="code-viewer">
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

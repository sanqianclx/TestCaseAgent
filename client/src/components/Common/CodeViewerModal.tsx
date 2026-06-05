/**
 * 代码查看器弹窗
 *
 * 包装 CodeViewer 到 Ant Design Modal 中，
 * 用于 Files、Tasks 等列表的"预览"操作。
 */

import React from 'react';
import { Modal } from 'antd';
import CodeViewer from './CodeViewer';

/**
 * 属性
 */
export interface CodeViewerModalProps {
  /** 是否可见 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 文件 ID（与 code 二选一） */
  fileId?: number;
  /** 直接显示的代码 */
  code?: string;
  /** 文件名 / 标题 */
  filename?: string;
  /** 语言 */
  language?: string | null;
  /** 弹窗宽度 */
  width?: number;
}

/**
 * 代码查看器弹窗
 */
const CodeViewerModal: React.FC<CodeViewerModalProps> = ({
  open,
  onClose,
  fileId,
  code,
  filename,
  language,
  width = 880,
}) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={width}
      destroyOnClose
      title={filename || '代码预览'}
      styles={{ body: { padding: 12 } }}
    >
      <CodeViewer
        fileId={fileId}
        code={code}
        language={language}
        maxHeight={Math.max(360, typeof window !== 'undefined' ? window.innerHeight - 220 : 480)}
      />
    </Modal>
  );
};

export default CodeViewerModal;

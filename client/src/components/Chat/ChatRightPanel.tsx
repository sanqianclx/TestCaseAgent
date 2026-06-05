/**
 * AI 聊天右侧三合一面板
 *
 * 三个 Tab：
 * - 工具调用：显示 AI 调用的工具步骤（read-file / parse-source / execute-tests 等）
 * - 任务日志：显示任务执行的流水日志
 * - 文件预览：显示 AI 生成的测试代码
 *
 * 支持折叠 / 展开，避免占用聊天宽度。
 */

import React, { useState } from 'react';
import { Tabs, List, Tag, Empty, Button, Space, Typography, Badge } from 'antd';
import {
  ToolOutlined,
  EyeOutlined,
  RightOutlined,
  CloseOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import CodeViewer from '../Common/CodeViewer';

const { Text } = Typography;
const { TabPane } = Tabs;

/**
 * 工具事件
 *
 * status: 'pending' 时表示该工具被框架 requireApproval 挂起，
 *        等待用户在右侧面板上批准或拒绝
 */
export type ToolEventStatus = 'pending' | 'approved' | 'declined' | 'done';

export interface ToolEvent {
  step?: string;
  message: string;
  at: number;
  /** 工具名（writeFile/shellRun/...） */
  toolName?: string;
  /** 工具参数 */
  args?: Record<string, any>;
  /** 框架 runId（用于调 /resume） */
  runId?: string;
  /** 工具调用 ID */
  toolCallId?: string;
  /** 关联任务 ID */
  taskId?: string;
  /** 审批状态 */
  status?: ToolEventStatus;
  /** 用户填写的附加说明 */
  answer?: string;
}

/**
 * 属性
 */
export interface ChatRightPanelProps {
  /** 是否折叠 */
  collapsed: boolean;
  /** 折叠/展开切换 */
  onToggleCollapse: () => void;
  /** 工具调用事件 */
  toolEvents: ToolEvent[];
  /** 当前活动任务 ID */
  activeTaskId?: string | null;
  /** 预览文件 ID（来自 complete 事件） */
  previewFileId?: number | null;
  /** 预览文件语言 */
  previewLanguage?: string | null;
  /** 任务是否正在执行 */
  isRunning: boolean;
  /** 宽度 */
  width?: number;
  /** 批准某条工具调用（点击 [批准] 按钮） */
  onApproveTool?: (event: ToolEvent) => void;
  /** 拒绝某条工具调用（点击 [拒绝] 按钮） */
  onDeclineTool?: (event: ToolEvent) => void;
}

/**
 * 工具步骤 Tag 颜色
 */
function stepColor(step?: string): string {
  if (!step) return 'default';
  if (step.includes('read')) return 'blue';
  if (step.includes('parse')) return 'purple';
  if (step.includes('execute')) return 'green';
  if (step.includes('coverage')) return 'cyan';
  if (step.includes('write')) return 'magenta';
  if (step.includes('register')) return 'gold';
  if (step.includes('init') || step.includes('start')) return 'geekblue';
  if (step.includes('complete')) return 'success';
  if (step.includes('fallback') || step.includes('error')) return 'red';
  return 'default';
}

/**
 * 聊天右侧面板
 */
const ChatRightPanel: React.FC<ChatRightPanelProps> = ({
  collapsed,
  onToggleCollapse,
  toolEvents,
  activeTaskId,
  previewFileId,
  previewLanguage,
  isRunning,
  width = 340,
  onApproveTool,
  onDeclineTool,
}) => {
  const [activeTab, setActiveTab] = useState<string>('tools');

  // 折叠时只显示竖排按钮
  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          flexShrink: 0,
          background: '#fff',
          borderLeft: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          gap: 8,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<RightOutlined style={{ transform: 'rotate(180deg)' }} />}
          onClick={onToggleCollapse}
          title="展开右侧面板"
        />
        <Button
          type={activeTab === 'tools' ? 'primary' : 'text'}
          size="small"
          icon={<ToolOutlined />}
          onClick={() => {
            setActiveTab('tools');
            onToggleCollapse();
          }}
          title="工具调用"
        />
        <Button
          type={activeTab === 'preview' ? 'primary' : 'text'}
          size="small"
          icon={<EyeOutlined />}
          onClick={() => {
            setActiveTab('preview');
            onToggleCollapse();
          }}
          title="文件预览"
        />
        {(isRunning || toolEvents.length > 0) && (
          <Badge
            count={toolEvents.length}
            size="small"
            style={{ backgroundColor: '#52c41a' }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: '#fff',
        borderLeft: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Space size={6}>
          <Text strong style={{ fontSize: 13 }}>
            实时面板
          </Text>
          {isRunning && <LoadingOutlined style={{ color: '#1890ff' }} />}
          {!isRunning && toolEvents.length > 0 && (
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          )}
        </Space>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onToggleCollapse}
          title="折叠面板"
        />
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ marginBottom: 0, paddingLeft: 8 }}
      >
        <TabPane
          tab={
            <span>
              <ToolOutlined /> 工具调用
              {toolEvents.length > 0 && (
                <Badge
                  count={toolEvents.length}
                  size="small"
                  offset={[6, -2]}
                  style={{ backgroundColor: '#52c41a' }}
                />
              )}
            </span>
          }
          key="tools"
          style={{ flex: 1, overflow: 'auto', padding: 8 }}
        >
          {toolEvents.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={isRunning ? '等待工具调用...' : '暂无工具调用'}
              style={{ marginTop: 40 }}
            />
          ) : (
            <List
              size="small"
              dataSource={toolEvents}
              renderItem={(e) => {
                const isPending = e.status === 'pending';
                const statusTag = isPending ? (
                  <Tag color="warning" style={{ marginRight: 0, fontSize: 10 }}>待审批</Tag>
                ) : e.status === 'approved' ? (
                  <Tag color="success" style={{ marginRight: 0, fontSize: 10 }}>已批准</Tag>
                ) : e.status === 'declined' ? (
                  <Tag color="error" style={{ marginRight: 0, fontSize: 10 }}>已拒绝</Tag>
                ) : null;
                return (
                  <List.Item style={{ padding: '6px 4px', display: 'block' }}>
                    <Space align="start" style={{ width: '100%' }} size={6}>
                      <Tag color={stepColor(e.step)} style={{ marginRight: 0 }}>
                        {e.step || 'step'}
                      </Tag>
                      {statusTag}
                      <Text style={{ fontSize: 12, flex: 1 }}>{e.message}</Text>
                    </Space>
                    {e.answer && (
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2, paddingLeft: 4 }}>
                        备注：{e.answer}
                      </div>
                    )}
                    {isPending && (onApproveTool || onDeclineTool) && (
                      <Space size={4} style={{ marginTop: 4, paddingLeft: 4 }}>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => onApproveTool?.(e)}
                        >
                          批准
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={() => onDeclineTool?.(e)}
                        >
                          拒绝
                        </Button>
                      </Space>
                    )}
                  </List.Item>
                );
              }}
            />
          )}
        </TabPane>
        <TabPane
          tab={
            <span>
              <EyeOutlined /> 文件预览
            </span>
          }
          key="preview"
          style={{ flex: 1, overflow: 'auto', padding: 8 }}
        >
          {previewFileId ? (
            <>
              {activeTaskId && (
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 11,
                    color: '#888',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>任务: {activeTaskId.slice(0, 8)}...</span>
                </div>
              )}
              <CodeViewer
                fileId={previewFileId}
                language={previewLanguage || 'python'}
                maxHeight={typeof window !== 'undefined' ? window.innerHeight - 220 : 480}
              />
            </>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={isRunning ? 'AI 正在生成...' : '任务完成后将在此显示测试代码'}
              style={{ marginTop: 40 }}
            />
          )}
        </TabPane>
      </Tabs>
    </div>
  );
};

export default ChatRightPanel;

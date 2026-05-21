# 测试用例文档

- 生成时间：2026-05-21 23:45:56
- 用例数量：30

## 测试用例

| 编号 | 标题 | 优先级 | 类型 | 前置条件 | 预期结果 |
|------|------|--------|------|----------|----------|
| TC-001 | add_positive 正常调用验证 | P0 | 功能 | 被测函数可导入 | 分别返回 8, 300, 0 |
| TC-002 | add_positive 边界输入验证 | P1 | 边界 | 被测函数可导入 | 分别返回 2*10^6, 42, 42 |
| TC-003 | add_positive 负数输入验证 | P1 | 异常 | 被测函数可导入 | 分别返回 -8, 10, 5 |
| TC-004 | divide_zero 正常除法 | P0 | 功能 | 被测函数可导入 | 分别返回 5.0, 3.0, 3.5 |
| TC-005 | divide_zero 除零异常 | P1 | 边界 | 被测函数可导入 | 抛出 ZeroDivisionError |
| TC-006 | divide_zero 负数除法 | P1 | 异常 | 被测函数可导入 | 分别返回 -5.0, -5.0, 2.0 |
| TC-007 | faulty_logic 通过分支 | P0 | 功能 | 被测函数可导入 | 均返回 '通过'（实际实现以 >=80 为界） |
| TC-008 | faulty_logic 不通过分支 | P1 | 边界 | 被测函数可导入 | 均返回 '不通过'（60 在 docstring 声称通过但实际不通过） |
| TC-009 | faulty_logic 负数输入 | P1 | 异常 | 被测函数可导入 | 返回 '不通过'，不静默出错 |
| TC-010 | bad_math 正常调用 | P0 | 功能 | 被测函数可导入 | 返回 8（实际实现为加法） |
| TC-011 | bad_math 边界输入 | P1 | 边界 | 被测函数可导入 | 分别返回 5, 100, 0 |
| TC-012 | bad_math 负数输入 | P1 | 异常 | 被测函数可导入 | 分别返回 4, -10 |
| TC-013 | argument_guard 正数返回字符串 | P0 | 功能 | 被测函数可导入 | 返回 'value is 5'（非中文字符串） |
| TC-014 | argument_guard 大正数边界 | P1 | 边界 | 被测函数可导入 | 返回 'value is 999999' |
| TC-015 | argument_guard 负数抛异常 & 零不抛异常 | P1 | 异常 | 被测函数可导入 | -1 抛出 ValueError；0 因 bug（< 而非 <=）不抛异常返回 'value is 0' |
| TC-016 | performance_trap 正常调用 | P0 | 功能 | 被测函数可导入 | 返回 [0,1,2,3]（off-by-one: range(n+1)） |
| TC-017 | performance_trap n=0 边界 | P1 | 边界 | 被测函数可导入 | 返回 [0]（off-by-one 导致多一个元素） |
| TC-018 | performance_trap n=1 | P1 | 异常 | 被测函数可导入 | 返回 [0, 1] |
| TC-019 | BuggyCounter __init__ 初始值 | P0 | 功能 | 被测类可导入 | 初始 count = 0 |
| TC-022 | BuggyCounter increment 基本 | P0 | 功能 | 被测类可导入 | 返回 1，get_value() 为 1 |
| TC-023 | BuggyCounter 多次 increment | P1 | 边界 | 被测类可导入 | get_value() = 3 |
| TC-024 | BuggyCounter reset 后 increment | P1 | 边界 | 被测类可导入 | reset 后 count=1（bug），再 increment 后 count=2 |
| TC-025 | BuggyCounter decrement 基本 | P0 | 功能 | 被测类可导入 | 3-2=1（bug: 减2而非减1） |
| TC-026 | BuggyCounter 从0递减 | P1 | 边界 | 被测类可导入 | 返回 -2 |
| TC-027 | BuggyCounter 多次 decrement | P1 | 异常 | 被测类可导入 | 4-2=2, 2-2=0 |
| TC-028 | BuggyCounter reset 基本 | P0 | 功能 | 被测类可导入 | count=1（bug: 应清零实际设为1） |
| TC-029 | BuggyCounter 连续两次 reset | P1 | 边界 | 被测类可导入 | 每次 reset 后 count 均为 1 |
| TC-031 | BuggyCounter get_value 初始值 | P0 | 功能 | 被测类可导入 | 返回 0 |
| TC-032 | BuggyCounter 多操作后 get_value | P1 | 边界 | 被测类可导入 | 2-2=0 |
| TC-033 | BuggyCounter 完整生命周期 | P1 | 异常 | 被测类可导入 | 最终 get_value()=2（含 bug 影响） |

## 执行摘要

- 状态：passed
- 通过：31
- 失败：0
- 错误：0
- 退出码：0
- 耗时：798 ms
- 是否超时：False
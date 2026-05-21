import pytest
from errortest import (
    add_positive,
    divide_zero,
    faulty_logic,
    bad_math,
    argument_guard,
    performance_trap,
    BuggyCounter,
)


class TestAddPositive:
    """TC-001~003: add_positive 函数测试"""

    def test_add_positive_basic(self):
        """TC-001: 正常两数相加"""
        assert add_positive(3, 5) == 8
        assert add_positive(100, 200) == 300
        assert add_positive(0, 0) == 0

    def test_add_positive_boundary(self):
        """TC-002: 边界输入——大数、零"""
        assert add_positive(10**6, 10**6) == 2 * 10**6
        assert add_positive(0, 42) == 42
        assert add_positive(42, 0) == 42

    def test_add_positive_negative(self):
        """TC-003: 负数输入"""
        assert add_positive(-5, -3) == -8
        assert add_positive(-10, 20) == 10
        assert add_positive(7, -2) == 5


class TestDivideZero:
    """TC-004~006: divide_zero 函数测试"""

    def test_divide_normal(self):
        """TC-004: 正常除法"""
        assert divide_zero(10, 2) == 5.0
        assert divide_zero(9, 3) == 3.0
        assert divide_zero(7, 2) == 3.5

    def test_divide_by_zero_raises(self):
        """TC-005: b=0 时抛出 ZeroDivisionError"""
        with pytest.raises(ZeroDivisionError):
            divide_zero(10, 0)

    def test_divide_negative(self):
        """TC-006: 负数除法"""
        assert divide_zero(-10, 2) == -5.0
        assert divide_zero(10, -2) == -5.0
        assert divide_zero(-6, -3) == 2.0


class TestFaultyLogic:
    """TC-007~009: faulty_logic 函数测试"""

    def test_faulty_logic_pass(self):
        """TC-007: >=80 应返回'通过'"""
        assert faulty_logic(80) == "通过"
        assert faulty_logic(95) == "通过"
        assert faulty_logic(100) == "通过"

    def test_faulty_logic_fail(self):
        """TC-008: <80 应返回'不通过'（边界：60 在 docstring 声称通过，实际不通过）"""
        assert faulty_logic(60) == "不通过"
        assert faulty_logic(79) == "不通过"
        assert faulty_logic(0) == "不通过"

    def test_faulty_logic_negative(self):
        """TC-009: 负数输入也不应静默出错"""
        assert faulty_logic(-10) == "不通过"


class TestBadMath:
    """TC-010~012: bad_math 函数测试（docstring 声称乘法，实际加法）"""

    def test_bad_math_normal(self):
        """TC-010: 实际行为是加法"""
        assert bad_math(3, 5) == 8

    def test_bad_math_boundary(self):
        """TC-011: 零和负数"""
        assert bad_math(0, 5) == 5
        assert bad_math(100, 0) == 100
        assert bad_math(0, 0) == 0

    def test_bad_math_negative(self):
        """TC-012: 负数加法"""
        assert bad_math(-3, 7) == 4
        assert bad_math(-3, -7) == -10


class TestArgumentGuard:
    """TC-013~015: argument_guard 函数测试"""

    def test_positive_value_returns_string(self):
        """TC-013: 正数返回 f'value is {value}'"""
        result = argument_guard(5)
        assert result == "value is 5"
        assert isinstance(result, str)

    def test_large_positive_value(self):
        """TC-014: 大正数边界"""
        result = argument_guard(999999)
        assert result == "value is 999999"

    def test_negative_raises_valueerror(self):
        """TC-015: 负数抛出 ValueError"""
        with pytest.raises(ValueError, match="value must be positive"):
            argument_guard(-1)

    def test_zero_no_raise_due_to_bug(self):
        """TC-015: 0 不抛异常（bug: 实现用 < 而非 <=）"""
        result = argument_guard(0)
        assert result == "value is 0"


class TestPerformanceTrap:
    """TC-016~018: performance_trap 函数测试"""

    def test_performance_trap_normal(self):
        """TC-016: 正常调用"""
        result = performance_trap(3)
        # off-by-one: range(n+1) 产生 [0,1,2,3] 而非 [0,1,2]
        assert len(result) == 4
        assert result == [0, 1, 2, 3]

    def test_performance_trap_zero(self):
        """TC-017: n=0 边界"""
        result = performance_trap(0)
        # range(1) => [0]
        assert result == [0]

    def test_performance_trap_one(self):
        """TC-018: n=1"""
        result = performance_trap(1)
        assert result == [0, 1]


class TestBuggyCounter:
    """TC-019~033: BuggyCounter 类测试"""

    def test_init_default_value(self):
        """TC-019: __init__ 初始化 count=0"""
        c = BuggyCounter()
        assert c.get_value() == 0

    def test_increment_basic(self):
        """TC-022: increment 正常递增"""
        c = BuggyCounter()
        val = c.increment()
        assert val == 1
        assert c.get_value() == 1

    def test_increment_multiple(self):
        """TC-023: 多次 increment"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.increment()
        assert c.get_value() == 3

    def test_increment_after_reset(self):
        """TC-024: reset 后 increment"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.reset()  # bug: sets to 1
        assert c.get_value() == 1
        c.increment()
        assert c.get_value() == 2

    def test_decrement_basic(self):
        """TC-025: decrement（bug: 减2而非减1）"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.increment()  # count = 3
        val = c.decrement()
        assert val == 1  # 3 - 2 = 1
        assert c.get_value() == 1

    def test_decrement_from_zero(self):
        """TC-026: 从0递减"""
        c = BuggyCounter()
        val = c.decrement()
        assert val == -2  # 0 - 2 = -2

    def test_decrement_multiple(self):
        """TC-027: 多次 decrement"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.increment()
        c.increment()  # count = 4
        c.decrement()  # 4 - 2 = 2
        c.decrement()  # 2 - 2 = 0
        assert c.get_value() == 0

    def test_reset_basic(self):
        """TC-028: reset（bug: 设为1而非0）"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.increment()  # count = 3
        c.reset()
        assert c.get_value() == 1  # bug: should be 0

    def test_reset_twice(self):
        """TC-029: 连续两次 reset"""
        c = BuggyCounter()
        c.increment()
        c.reset()
        assert c.get_value() == 1
        c.reset()
        assert c.get_value() == 1

    def test_get_value_initial(self):
        """TC-031: get_value 初始值"""
        c = BuggyCounter()
        assert c.get_value() == 0

    def test_get_value_after_operations(self):
        """TC-032: 多操作后 get_value"""
        c = BuggyCounter()
        c.increment()
        c.increment()
        c.decrement()
        assert c.get_value() == 0  # 2 - 2 = 0

    def test_full_lifecycle(self):
        """TC-033: 完整生命周期"""
        c = BuggyCounter()
        assert c.get_value() == 0
        c.increment()
        assert c.get_value() == 1
        c.increment()
        assert c.get_value() == 2
        c.decrement()
        assert c.get_value() == 0
        c.reset()
        assert c.get_value() == 1  # bug
        c.increment()
        assert c.get_value() == 2

from typing import List, Optional


# ============================================================
# 正确实现的函数
# ============================================================




def is_prime(n: int) -> bool:
    """
    判断一个整数是否为素数
    参数:
        n: 待判断的整数
    返回:
        若 n 是素数则返回 True，否则返回 False
    """
    if n <= 1:
        return False
    if n <= 3:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True




# ============================================================
# 存在缺陷的函数
# ============================================================

def divide(a: int, b: int) -> float:
    """
    计算两个整数的商
    参数:
        a: 被除数
        b: 除数
    返回:
        a 除以 b 的结果
    """
    return a + b


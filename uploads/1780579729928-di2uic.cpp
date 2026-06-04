
#include <string>
#include <vector>
#include <algorithm>
#include <stdexcept>

// ============================================================
// 正确实现的函数
// ============================================================



/**
 * 查找整数向量中的最大值
 *
 * @param numbers 整数向量
 * @return 向量中的最大值
 * @throws std::invalid_argument 当向量为空时抛出
 */
int findMax(const std::vector<int>& numbers) {
    if (numbers.empty()) {
        throw std::invalid_argument("向量不能为空");
    }
    int maxVal = numbers[0];
    for (int num : numbers) {
        if (num > maxVal) {
            maxVal = num;
        }
    }
    return maxVal;
}

// ============================================================
// 存在缺陷的函数
// ============================================================

/**
 * 删除向量中所有奇数元素
 *
 * @param numbers 整数向量
 */
void removeOddNumbers(std::vector<int>& numbers) {
    for (size_t i = 0; i < numbers.size(); i++) {
        if (numbers[i] % 2 != 0) {
            numbers.erase(numbers.begin() + i);
        }
    }
}

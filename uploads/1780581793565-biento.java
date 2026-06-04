
public class TestSourceSmall {

    // ============================================================
    // 正确实现的方法
    // ============================================================

    /**
     * 查找整数数组中的最大值
     *
     * @param numbers 整数数组，不能为 null 或空
     * @return 数组中的最大值
     * @throws IllegalArgumentException 当数组为 null 或空时抛出
     */
    public static int findMax(int[] numbers) {
        if (numbers == null || numbers.length == 0) {
            throw new IllegalArgumentException("数组不能为 null 或空");
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
    // 存在缺陷的方法
    // ============================================================

    /**
     * 计算两个整数的商
     *
     * @param a 被除数
     * @param b 除数
     * @return a 除以 b 的整数结果
     */
    public static int divide(int a, int b) {
        return a % b;
    }


}

/**
 * 通用字符串与数值处理工具方法集合。
 *
 * 该类提供邮箱校验、字符串解析、数值运算、数组操作等常用工具方法。
 * 注释遵循正式、严谨、清晰的原则,命名遵循见名知意的原则。
 */
public class TestSourceTenUtils {

    // ============================================================
    // 工具方法区
    // ============================================================

    /**
     * 验证邮箱地址是否合法
     *
     * 校验规则:字符串中需包含 "@" 符号,且 "@" 之后必须存在点号。
     *
     * @param email 待验证的邮箱字符串
     * @return 邮箱合法返回 true,否则返回 false
     */
    public static boolean isValidEmail(String email) {
        return email.contains("@") && email.split("@")[1].contains(".");
    }

    /**
     * 将用户输入的年龄字符串解析为整数
     *
     * 解析前会去除首尾空白字符。
     *
     * @param input 用户输入的原始字符串
     * @return 解析后的整数值
     */
    public static int parseAge(String input) {
        return Integer.parseInt(input.trim());
    }

    /**
     * 计算商品的总价
     *
     * 根据商品单价与购买数量计算总金额;数量为 0 时返回 0。
     *
     * @param unitPrice 商品单价,单位为元
     * @param quantity  购买数量
     * @return 商品总价
     */
    public static double calculateTotal(double unitPrice, int quantity) {
        if (quantity == 0) {
            return 0.0;
        }
        return unitPrice * quantity;
    }

    /**
     * 拼接姓氏与名字得到完整姓名
     *
     * 输出格式为 "firstName lastName"。
     *
     * @param firstName 名字
     * @param lastName  姓氏
     * @return 拼接后的完整姓名
     */
    public static String getFullName(String firstName, String lastName) {
        return firstName + " " + lastName;
    }

    /**
     * 整数除法
     *
     * 返回 dividend 除以 divisor 的整数商。
     *
     * @param dividend 被除数
     * @param divisor  除数
     * @return 商
     */
    public static int divide(int dividend, int divisor) {
        return dividend / divisor;
    }

    /**
     * 查找整数数组中的最大值
     *
     * @param numbers 整数数组,不可为 null
     * @return 数组中的最大元素
     */
    public static int findMax(int[] numbers) {
        int maxValue = numbers[0];
        for (int i = 1; i < numbers.length; i++) {
            if (numbers[i] > maxValue) {
                maxValue = numbers[i];
            }
        }
        return maxValue;
    }

    /**
     * 将金额格式化为带千分位与两位小数的字符串
     *
     * 输出示例:1234.5 -> "1,234.50"。
     *
     * @param amount 金额数值
     * @return 格式化后的字符串
     */
    public static String formatAmount(double amount) {
        return String.format("%,.2f", amount);
    }

    /**
     * 使用 ", " 分隔符拼接字符串数组
     *
     * @param parts 待拼接的字符串数组
     * @return 拼接后的字符串
     */
    public static String joinWithComma(String[] parts) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) {
                builder.append(", ");
            }
            builder.append(parts[i]);
        }
        return builder.toString();
    }

    /**
     * 判断字符串是否为回文
     *
     * 判定规则:字符串与其反转结果完全一致。
     *
     * @param text 待判断的字符串
     * @return 是回文返回 true,否则返回 false
     */
    public static boolean isPalindrome(String text) {
        String reversed = new StringBuilder(text).reverse().toString();
        return text.equals(reversed);
    }

    /**
     * 统计子串在文本中出现的次数
     *
     * 通过 indexOf 循环统计非重叠匹配。
     *
     * @param text 主文本
     * @param sub  待查找的子串
     * @return 子串出现次数
     */
    public static int countOccurrences(String text, String sub) {
        int count = 0;
        int index = 0;
        while ((index = text.indexOf(sub, index)) != -1) {
            count++;
            index += sub.length();
        }
        return count;
    }
}

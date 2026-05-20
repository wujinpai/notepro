# Markdown 语法参考

NotePro 使用标准 Markdown 语法，支持扩展的语法元素和数学公式。

## 基础语法

### 标题

```markdown
# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题
```

### 段落

```markdown
这是一个普通段落。

这是另一个段落，两个换行分隔。
```

### 粗体

```markdown
**粗体文本**
```

### 斜体

```markdown
*斜体文本*
```

### 删除线

```markdown
~~删除的文本~~
```

### 引用

```markdown
> 这是一个引用块
>
> 可以有多行
```

### 列表

```markdown
- 无序列表项 1
- 无序列表项 2
- 无序列表项 3

1. 有序列表项 1
2. 有序列表项 2
3. 有序列表项 3
```

### 代码

```markdown
行内代码：`console.log('Hello')`

代码块：
```javascript
function hello() {
  console.log('Hello, world!');
}
```
```

### 链接

```markdown
[链接文字](https://example.com)
```

### 图片

```markdown
![图片描述](https://example.com/image.jpg)
```

### 分隔线

```markdown
---
```

### 表格

```markdown
| 列1 | 列2 | 列3 |
|------|------|------|
| 内容1 | 内容2 | 内容3 |
| 内容4 | 内容5 | 内容6 |
```

---

## 数学公式 (KaTeX)

### 行内公式

```markdown
爱因斯坦质能方程：$E = mc^2$
```

### 块级公式

```markdown
$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$
```

### 常用公式示例

```markdown
### 求和：$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

### 积分：$\int_{a}^{b} f(x) dx$

### 矩阵：$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$
```

---

## 编辑器功能

NotePro 的 Markdown 编辑器提供以下快捷工具：

| 按钮 | 功能 | 快捷键 |
|------|------|
| **B** | 加粗 | Ctrl+B |
| *I* | 斜体 | Ctrl+I |
| ~~S~~ | 删除线 | - |
| H | 标题 | - |
| > | 引用 | - |
| `{ }` | 代码块 | - |
| • | 列表 | - |
| 🔗 | 链接 | - |
| 📷 | 图片 | - |
| — | 分割线 | - |
| 👁️ | 预览切换 | - |

---

## 完整示例

```markdown
# 文章标题

## 介绍

这是一段**粗体**和*斜体*和~~删除线~~。

## 列表

- 第一项
- 第二项
  - 嵌套项 1
  - 嵌套项 2

## 引用

> 这是引用内容
>
> 多行引用

## 代码

```python
def add(a, b):
    return a + b
```

## 数学公式

### 行内：$e^{i\pi} = -1$

### 块级：
$$
f(x) = \int_{-\infty}^{\infty} \hat{f}(\xi) e^{2\pi i \xi x} d\xi
$$

## 表格

| 姓名 | 年龄 | 职业 |
|------|------|------|
| 张三 | 28 | 工程师 |
| 李四 | 32 | 设计师 |
```

---

## 更多

- [CommonMark 参考](https://commonmark.org/help/)
- [KaTeX 文档](https://katex.org/docs/supported.html)

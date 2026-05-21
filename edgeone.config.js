/**
 * EdgeOne Pages 项目配置文件
 */

module.exports = {
  // 构建配置
  build: {
    // 需要 externalize 的包（这些是 EdgeOne Pages 内置包，不需要打包）
    external: [
      '@edgeone/pages-blob'
    ]
  }
};

// 最简单的测试函数
export default function onRequest(context) {
  return new Response('Hello from Edge Functions!', {
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
    },
  });
}
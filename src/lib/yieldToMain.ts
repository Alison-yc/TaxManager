/** 让出主线程，避免长时间同步计算导致页面无响应 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

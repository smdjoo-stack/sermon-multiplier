// 옵시디언은 Electron 환경에서 실행되므로 런타임에는 'electron' 모듈을 사용할 수 있다.
// esbuild에서 external 처리되므로 타입 선언만 최소한으로 둔다.
declare module "electron" {
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
}

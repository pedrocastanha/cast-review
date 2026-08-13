import { resolveAnchor, rightSideLines } from './patch-anchor.helper';

const SAMPLE_PATCH = `@@ -10,4 +10,5 @@ export function foo() {
     const a = 1
-    const b = 2
+    const b = 3
+    const c = 4
     return a + b
`;

const files = [
  { filename: 'src/foo.ts', status: 'modified', patch: SAMPLE_PATCH },
];

describe('rightSideLines', () => {
  it('coleta linhas do arquivo novo (contexto e adições)', () => {
    // new file starts at 10: space, plus, plus, space → 10,11,12,13
    expect(rightSideLines(SAMPLE_PATCH)).toEqual([10, 11, 12, 13]);
  });
});

describe('resolveAnchor', () => {
  it('usa a linha exata quando ela está no hunk', () => {
    expect(resolveAnchor('src/foo.ts', 11, files)).toEqual({
      path: 'src/foo.ts',
      line: 11,
    });
  });

  it('estala na RIGHT mais próxima quando a linha não está no hunk', () => {
    expect(resolveAnchor('src/foo.ts', 1, files)?.line).toBe(10);
    expect(resolveAnchor('src/foo.ts', 99, files)?.line).toBe(13);
  });

  it('aceita endLine só se as duas estiverem no hunk', () => {
    expect(resolveAnchor('src/foo.ts', 11, files, 12)).toEqual({
      path: 'src/foo.ts',
      line: 12,
      startLine: 11,
    });
    expect(resolveAnchor('src/foo.ts', 11, files, 80)).toEqual({
      path: 'src/foo.ts',
      line: 11,
    });
  });

  it('recusa arquivo removido, sem patch ou fora da PR', () => {
    expect(
      resolveAnchor('gone.ts', 1, [
        { filename: 'gone.ts', status: 'removed', patch: SAMPLE_PATCH },
      ]),
    ).toBeNull();
    expect(
      resolveAnchor('src/foo.ts', 11, [
        { filename: 'src/foo.ts', status: 'modified' },
      ]),
    ).toBeNull();
    expect(resolveAnchor('src/other.ts', 11, files)).toBeNull();
  });

  it('recusa path com parent directory', () => {
    expect(resolveAnchor('../secret.ts', 1, files)).toBeNull();
  });
});

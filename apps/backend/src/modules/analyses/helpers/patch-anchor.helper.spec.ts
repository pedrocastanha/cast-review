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
  it('usa a linha exata quando a citação bate com o hunk', () => {
    expect(resolveAnchor('src/foo.ts', 11, '    const b = 3', files)).toEqual({
      path: 'src/foo.ts',
      line: 11,
    });
    expect(resolveAnchor('src/foo.ts', 11, '    const b = 9', files)).toBeNull();
  });

  it('recusa linhas fora do hunk sem deslocar o comentário', () => {
    expect(resolveAnchor('src/foo.ts', 1, 'not in patch', files)).toBeNull();
    expect(resolveAnchor('src/foo.ts', 99, 'not in patch', files)).toBeNull();
  });

  it('deriva o intervalo da citação de várias linhas', () => {
    const excerpt = '    const b = 3\n    const c = 4';
    expect(resolveAnchor('src/foo.ts', 11, excerpt, files)).toEqual({
      path: 'src/foo.ts',
      line: 12,
      startLine: 11,
    });
  });

  it('recusa arquivo removido, sem patch ou fora da PR', () => {
    expect(
      resolveAnchor('gone.ts', 1, 'some code', [
        { filename: 'gone.ts', status: 'removed', patch: SAMPLE_PATCH },
      ]),
    ).toBeNull();
    expect(
      resolveAnchor('src/foo.ts', 11, '    const b = 3', [
        { filename: 'src/foo.ts', status: 'modified' },
      ]),
    ).toBeNull();
    expect(
      resolveAnchor('src/other.ts', 11, '    const b = 3', files),
    ).toBeNull();
  });

  it('recusa path com parent directory', () => {
    expect(resolveAnchor('../secret.ts', 1, 'not in patch', files)).toBeNull();
  });
});

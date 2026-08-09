export function Spinner({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'size-8 border-[2.5px]' : 'size-5 border-2';

  return (
    <span
      className={`${dim} animate-spin-precise rounded-full border-border-strong border-t-accent`}
      role="status"
      aria-label="Carregando"
    />
  );
}

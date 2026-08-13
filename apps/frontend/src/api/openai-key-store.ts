const KEY = 'cast_review.openaiKey';

/** Key só na sessão do browser — some ao fechar a aba. Não vai pro localStorage. */
export const openaiKeyStore = {
  get: () => sessionStorage.getItem(KEY) ?? '',
  set: (value: string) => {
    if (value.trim()) sessionStorage.setItem(KEY, value.trim());
    else sessionStorage.removeItem(KEY);
  },
  clear: () => sessionStorage.removeItem(KEY),
};

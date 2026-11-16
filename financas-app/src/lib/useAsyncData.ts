import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Carrega dados sempre que a tela ganha foco (ex.: ao voltar da edição) ou
 * quando algum valor de `deps` muda, e expõe `reload` para recarregar à mão.
 * `deps` deve conter apenas valores simples (string, número, booleano) ou
 * objetos estáveis (como o banco de dados).
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; });
  const depsKey = deps.map((d) => (typeof d === 'object' && d !== null ? 'obj' : String(d))).join('|');

  const load = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    loaderRef.current()
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => console.warn(e))
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [depsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(load);
  return { data, reload: load, loading };
}

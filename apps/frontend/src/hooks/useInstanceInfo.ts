import { useEffect, useState } from 'react';
import { fetchInstanceInfo, type InstanceInfo } from '../api/instance.api';

export function useInstanceInfo(): InstanceInfo | null {
  const [info, setInfo] = useState<InstanceInfo | null>(null);

  useEffect(() => {
    let active = true;
    fetchInstanceInfo().then((value) => {
      if (active) setInfo(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return info;
}

import { useEffect, useState } from 'react';
import { resolveTheme } from '../../terminal/terminalThemes';

function getThemeBg(): string {
  const themeId = localStorage.getItem('terminalTheme') || 'default';
  const isDark = document.documentElement.classList.contains('dark');
  return resolveTheme(themeId, isDark).background || (isDark ? '#1a1a1a' : '#ffffff');
}

export function useThemeBackground(): string {
  const [themeBg, setThemeBg] = useState(getThemeBg);

  useEffect(() => {
    const update = () => setThemeBg(getThemeBg());

    window.addEventListener('terminalThemeChange', update);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'terminalTheme') update();
    };
    window.addEventListener('storage', onStorage);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      window.removeEventListener('terminalThemeChange', update);
      window.removeEventListener('storage', onStorage);
      observer.disconnect();
    };
  }, []);

  return themeBg;
}

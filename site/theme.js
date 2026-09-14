try {
  const theme = localStorage.getItem('askin.site.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* System theme remains available when storage is blocked. */ }

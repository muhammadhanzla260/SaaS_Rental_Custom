/**
 * Inline script that picks light or dark before first paint:
 * personal override (localStorage) > organisation default > device setting.
 */
export function themeScript(orgDefault?: string) {
  const setDefault = orgDefault ? `d.setAttribute('data-theme-default',${JSON.stringify(orgDefault)});` : '';
  return `(function(){try{var d=document.documentElement;${setDefault}var o=localStorage.getItem('theme-override');var p=o||d.getAttribute('data-theme-default')||'system';var m=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;d.setAttribute('data-theme',m);}catch(e){}})();`;
}

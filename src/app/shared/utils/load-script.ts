/**
 * Carga un script externo una sola vez y resuelve cuando está listo.
 * Sirve para librerías de CDN que solo se necesitan en algunas pantallas
 * (fabric.js en el editor de imágenes, JSZip al comprimir evidencias).
 */
const loading = new Map<string, Promise<void>>();

export const FABRIC_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js';
export const JSZIP_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

export function loadScript(src: string): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error(`No se puede cargar ${src} fuera del navegador`));
  }

  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading.delete(src);
        script.remove();
        reject(new Error(`No se pudo cargar el script ${src}`));
      };
      document.head.appendChild(script);
    });
    loading.set(src, promise);
  }
  return promise;
}

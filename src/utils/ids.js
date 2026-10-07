/* utils/ids.js — geração de ids locais. */
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);

export { uid };

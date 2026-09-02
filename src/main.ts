import './ui/styles.css';
import { start } from './ui/app';

start();

// オフラインでも開けるようにする。失敗しても本体の動作には影響しない。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 登録できない環境（file:// など）では黙って諦める */
    });
  });
}

/* ぽいっとHP 写真アップロードページ
   ヒアリングの質問はGoogleフォームで受ける。写真だけはフォームがGoogleログインを
   要求して離脱するため、このページ（ログイン不要・トークン認証のみ）で受け取る。
   バックエンド: automation/poitto_hp_backend/Code.js の hearing_get / hearing_upload */
(function () {
  'use strict';
  var EP = 'https://script.google.com/macros/s/AKfycbzftG_O0GsR_8_TYwUwSGfSFPMCjXscWfw0jmTIB54H8NrH0SnjgH445IDDOKoHnNt8XA/exec';
  var MAX_EDGE = 1600;          // 長辺がこれを超えたら縮小して送る
  var SHRINK_OVER = 2 * 1024 * 1024;
  var MAX_BYTES = 8 * 1024 * 1024;

  var token = '';
  var m = String(location.hash || '').match(/[#&]t=([0-9a-f]{32})/);
  if (m) token = m[1];

  var elShop = document.getElementById('shop');
  var elReady = document.getElementById('ready');
  var elBad = document.getElementById('bad');
  var elBadMsg = document.getElementById('badmsg');
  var elCnt = document.getElementById('cnt');
  var elList = document.getElementById('list');
  var elDone = document.getElementById('done');
  var elPick = document.getElementById('pick');

  function show(el) { el.classList.remove('hide'); }
  function hide(el) { el.classList.add('hide'); }

  function fail(msg) {
    if (msg) elBadMsg.textContent = msg;
    hide(elReady);
    show(elBad);
  }

  function post(payload) {
    return fetch(EP, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function load() {
    if (!token) { fail(); return; }
    fetch(EP + '?action=hearing_get&t=' + token)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) {
          fail('このリンクは使えなくなっています。メールに記載のリンクからお開きください。');
          return;
        }
        if (d.shop) elShop.textContent = d.shop;
        elCnt.textContent = String(d.count || 0);
        (d.photos || []).forEach(function (p) { addRow(p.name, '受け取り済み', 'ok', ''); });
        if ((d.count || 0) > 0) show(elDone);
        show(elReady);
      })
      .catch(function () {
        fail('通信できませんでした。時間をおいてもう一度お開きください。');
      });
  }

  function addRow(name, status, cls, thumb) {
    var li = document.createElement('li');
    var img = document.createElement('img');
    if (thumb) img.src = thumb;
    img.alt = '';
    var fn = document.createElement('span');
    fn.className = 'fn';
    fn.textContent = name;
    var st = document.createElement('span');
    st.className = 'st' + (cls ? ' ' + cls : '');
    st.textContent = status;
    li.appendChild(img);
    li.appendChild(fn);
    li.appendChild(st);
    elList.appendChild(li);
    return st;
  }

  // 2MB超、または長辺1600px超はcanvasで縮小してJPEGにする（通信量と失敗を減らす）
  function toDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('read')); };
      fr.onload = function () {
        var src = String(fr.result || '');
        if (file.size <= SHRINK_OVER) { resolve({ data: src, mime: file.type || 'image/jpeg' }); return; }
        var im = new Image();
        im.onerror = function () { resolve({ data: src, mime: file.type || 'image/jpeg' }); };
        im.onload = function () {
          var w = im.naturalWidth, h = im.naturalHeight;
          var sc = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
          try {
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            cv.getContext('2d').drawImage(im, 0, 0, cw, ch);
            resolve({ data: cv.toDataURL('image/jpeg', 0.82), mime: 'image/jpeg' });
          } catch (e) {
            resolve({ data: src, mime: file.type || 'image/jpeg' });
          }
        };
        im.src = src;
      };
      fr.readAsDataURL(file);
    });
  }

  function upload(file) {
    var st = addRow(file.name, '準備中', '', '');
    return toDataUrl(file).then(function (o) {
      var li = st.parentNode;
      if (li) li.querySelector('img').src = o.data;
      var raw = o.data.split(',').pop();
      if (raw.length * 0.75 > MAX_BYTES) {
        st.textContent = '大きすぎます';
        st.className = 'st ng';
        return;
      }
      st.textContent = '送信中';
      return post({
        action: 'hearing_upload', t: token,
        filename: file.name, mime: o.mime, data: o.data
      }).then(function (d) {
        if (d && d.success) {
          st.textContent = '送信できました';
          st.className = 'st ok';
          if (d.count) elCnt.textContent = String(d.count);
          show(elDone);
        } else {
          st.textContent = '送れませんでした';
          st.className = 'st ng';
        }
      });
    }).catch(function () {
      st.textContent = '送れませんでした';
      st.className = 'st ng';
    });
  }

  elPick.addEventListener('change', function () {
    var files = Array.prototype.slice.call(elPick.files || []);
    elPick.value = '';
    // 1枚ずつ順番に送る（同時送信はGAS側の制限に当たるため）
    files.reduce(function (chain, f) {
      return chain.then(function () { return upload(f); });
    }, Promise.resolve());
  });

  load();
})();

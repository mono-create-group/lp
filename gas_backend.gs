// ================================================================
// mono.create — LPお問い合わせバックエンド (Google Apps Script)
// ================================================================
// 【デプロイ手順】
//   1. https://script.google.com で新規プロジェクトを作成
//   2. このファイルの全内容をコード.gsに貼り付け
//   3. ADMIN_KEY を任意の文字列に変更
//      → admin.html の ADMIN_PASSWORD と同じ値に揃える
//   4. CHATWORK_TOKEN / CHATWORK_ROOM_ID を設定
//   5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
//      実行ユーザー: 自分  /  アクセス: 全員（匿名含む）
//   6. デプロイURLを editor.html・admin.html の GAS_URL に貼る
// ================================================================

// ─── 設定 ───────────────────────────────────────────────────────
var ADMIN_KEY         = '20180412k';
var SPREADSHEET_ID    = '13RESWCy5tuOqVzzG5aoeIFtyDk--OrLnpaPDep5yjj0';
var CHATWORK_TOKEN    = 'f79405b3d71215d721e6a9d3f86f55a6';
var CHATWORK_ROOM_ID  = '437407663';  // HPお問い合わせ
var PAYMENT_ROOM_ID   = '437439208';  // 振込確認依頼
var CHATWORK_MENTION  = 9377370;
var SHEET_NAME        = 'inquiries';
var OWNER_EMAIL       = 'mono.create.group@gmail.com';  // オーナー通知先
var LP_BASE_URL       = 'https://mono-create-group.github.io/mono-create-lp/';

// ─── 振込先口座情報 ───────────────────────────────────────────────
var BANK_INFO = [
  '【振込先口座】',
  '銀行名  ：PayPay銀行（銀行コード：0033）',
  '支店名  ：うぐいす支店（ウグイス）　店番号：008',
  '口座種別：普通',
  '口座番号：4220331',
  '口座名義：ナカムラ コウタ',
].join('\n');

// ─── プラン→ヒアリングURL マッピング ─────────────────────────────
var HEARING_MAP = {
  'edit-short': 'hearing/short.html',
  'edit-long':  'hearing/set-long.html',
  'set-8':      'hearing/set-short.html',
  'set-10':     'hearing/set-short.html',
  'set-15':     'hearing/set-short.html',
  'set-30':     'hearing/set-short.html',
  'set-long':   'hearing/set-long.html',
  'mixed-std':  'hearing/set-long.html',
  'mixed-pre':  'hearing/set-long.html',
  'dispatch':   'hearing/dispatch.html',
};
// ────────────────────────────────────────────────────────────────

// ================================================================
// メール自動返信ヘルパー
// ================================================================

// お客様への自動返信（メールアドレスがある場合のみ送信）
function sendAutoReply(toEmail, name, subject, bodyLines) {
  if (!toEmail || toEmail.indexOf('@') === -1) return;
  var greeting = name ? name + ' 様\n\n' : '';
  var footer = [
    '',
    '─────────────────────────',
    'mono.create',
    'メール: ' + OWNER_EMAIL,
    'HP: ' + LP_BASE_URL,
    '─────────────────────────'
  ].join('\n');
  var body = greeting + bodyLines.join('\n') + footer;
  GmailApp.sendEmail(toEmail, subject, body, {
    name: 'mono.create',
    replyTo: OWNER_EMAIL
  });
}

// オーナーへのGmail通知（Chatworkが届かない場合のバックアップ）
function notifyOwnerEmail(subject, lines) {
  var body = lines.join('\n');
  GmailApp.sendEmail(OWNER_EMAIL, subject, body, { name: 'mono.create LP' });
}

// 文字列がメールアドレスか判定
function isEmail(str) {
  return !!(str && str.indexOf('@') !== -1 && str.indexOf('.') !== -1);
}
// ────────────────────────────────────────────────────────────────

// ── POST: フォーム受信 / ポートフォリオ追加・更新 ───────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // ポートフォリオ追加
    if (data.action === 'portfolio_add') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return addPortfolio(data);
    }

    // ポートフォリオ更新
    if (data.action === 'portfolio_update') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return updatePortfolio(data);
    }

    // 振込完了通知
    if (data.action === 'payment_notify') {
      return notifyPayment(data);
    }

    // 契約同意記録
    if (data.type === 'contract') {
      return saveContract(data);
    }

    // ヒアリングシート回答
    if (data.type === 'hearing') {
      return saveHearing(data);
    }

    // 売上記録（青色申告対応）
    if (data.type === 'sales') {
      return saveSales(data);
    }

    // お問い合わせフォーム送信
    var sheet = getOrCreateSheet();
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    sheet.appendRow([
      now,
      data.name        || '',
      data.company     || '',
      data.email       || '',
      data.chatwork_id || '',
      data.plan        || '',
      data.message     || '',
      '未対応'
    ]);

    if (CHATWORK_ROOM_ID) {
      notifyChatwork(data, now);
    }

    // ① お客様への自動返信メール
    sendAutoReply(data.email, data.name,
      '【mono.create】お問い合わせを受け付けました',
      [
        'この度はmono.createへのお問い合わせありがとうございます。',
        '内容を確認のうえ、1〜2営業日以内にご連絡いたします。',
        '',
        '▼ お問い合わせ内容',
        'プラン: ' + (data.plan || '未選択'),
        'ご相談内容: ' + (data.message || ''),
        '',
        'お急ぎの場合は、このメールへご返信ください。',
      ]
    );

    // ① オーナーへのGmailバックアップ通知
    notifyOwnerEmail(
      '【LP問い合わせ】' + (data.name || '名前なし') + ' — ' + (data.plan || 'プラン未選択'),
      [
        '受信日時: ' + now,
        'お名前: '  + (data.name        || ''),
        '会社名: '  + (data.company     || ''),
        'メール: '  + (data.email       || '未入力'),
        'CW ID: '   + (data.chatwork_id || '未入力'),
        'プラン: '  + (data.plan        || ''),
        '',
        '【相談内容】',
        data.message || '',
        '',
        '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
      ]
    );

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── GET: 管理画面向けAPI ──────────────────────────────────────
function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();
  var key    = e.parameter.key || '';

  // ── 認証不要の公開エンドポイント ──────────────────────────────
  // LPからkeyなしで呼ばれるポートフォリオ一覧は公開
  if (action === 'portfolio') {
    return listPortfolio();
  }

  // ── 以降は管理者キー必須 ──────────────────────────────────────
  if (key !== ADMIN_KEY) {
    return jsonResponse({ error: 'unauthorized' });
  }

  if (action === 'list') {
    return listInquiries();
  }

  if (action === 'update') {
    var row    = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updateStatus(row, status);
  }

  if (action === 'portfolio_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deletePortfolio(row);
  }

  if (action === 'contracts') {
    return listContracts();
  }

  if (action === 'hearings') {
    return listHearings();
  }

  if (action === 'sales') {
    return listSales();
  }

  if (action === 'payments') {
    return listPayments();
  }

  if (action === 'approve_payment') {
    var row = parseInt(e.parameter.row, 10);
    return approvePayment(row);
  }

  // ヒアリング案内メールを送信（問い合わせ一覧から）
  if (action === 'send_hearing_link') {
    return sendHearingLink(
      e.parameter.email   || '',
      e.parameter.name    || '',
      e.parameter.plan    || '',
      e.parameter.planKey || ''
    );
  }

  // お見積もり・振込依頼メールを送信（ヒアリング一覧から）
  if (action === 'send_payment_request') {
    return sendPaymentRequest(
      e.parameter.email   || '',
      e.parameter.name    || '',
      e.parameter.plan    || '',
      e.parameter.amount  || '',
      e.parameter.due     || '',
      e.parameter.note    || ''
    );
  }

  return jsonResponse({ error: 'unknown action' });
}

// ── 一覧取得 ─────────────────────────────────────────────────
function listInquiries() {
  var sheet = getOrCreateSheet();
  var values = sheet.getDataRange().getValues();

  // 1行目がヘッダーの場合はスキップ（初回appendRowより前に手動でヘッダーを入れた場合）
  var startRow = 2; // Spreadsheetの実際の行番号（1始まり、1行目=ヘッダー）

  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    data.push({
      row:         i + 1,          // Spreadsheet行番号（ステータス更新時に使用）
      date:        row[0] || '',
      name:        row[1] || '',
      company:     row[2] || '',
      email:       row[3] || '',
      chatwork_id: row[4] || '',
      plan:        row[5] || '',
      message:     row[6] || '',
      status:      row[7] || '未対応'
    });
  }

  // 新しい順に並び替え
  data.sort(function(a, b) { return b.date > a.date ? 1 : -1; });

  return jsonResponse({ data: data });
}

// ── ステータス更新 ────────────────────────────────────────────
function updateStatus(row, status) {
  var allowed = ['未対応', '対応中', '完了'];
  if (!row || allowed.indexOf(status) === -1) {
    return jsonResponse({ error: 'invalid params' });
  }
  var sheet = getOrCreateSheet();
  sheet.getRange(row, 8).setValue(status); // 8列目=ステータス
  return jsonResponse({ success: true });
}

// ── 振込完了通知 ──────────────────────────────────────────────
function notifyPayment(data) {
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // スプレッドシートに記録
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('payments');
  if (!sheet) {
    sheet = ss.insertSheet('payments');
    sheet.appendRow(['報告日時', '名前/振込名義', 'CW/メール', 'プラン', '金額', '振込日', '備考', 'ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  sheet.appendRow([
    now,
    data.name    || '',
    data.contact || '',
    data.plan    || '',
    data.amount  || '',
    data.date    || '',
    data.note    || '',
    '入金確認待ち'
  ]);

  // Chatwork通知
  if (PAYMENT_ROOM_ID) {
    var msg = [
      '[To:' + CHATWORK_MENTION + '] 中村航汰',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '💳 振込完了のご報告 — mono.create',
      '━━━━━━━━━━━━━━━━━━━━',
      '報告日時：' + now,
      '振込名義：' + (data.name    || '未入力'),
      '連絡先  ：' + (data.contact || '未入力'),
      'プラン  ：' + (data.plan    || '未入力'),
      '振込金額：' + (data.amount  || '未入力'),
      '振込日  ：' + (data.date    || '未入力'),
      '備考    ：' + (data.note    || 'なし'),
      '━━━━━━━━━━━━━━━━━━━━',
      '▶ 振込確認後、編集開始のご連絡をお願いします。',
    ].join('\n');

    var url = 'https://api.chatwork.com/v2/rooms/' + PAYMENT_ROOM_ID + '/messages';
    UrlFetchApp.fetch(url, {
      method:  'post',
      headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
      payload: { body: msg }
    });
  }

  // ④ お客様への自動返信メール（contactがメールアドレスの場合）
  if (isEmail(data.contact)) {
    sendAutoReply(data.contact, data.name,
      '【mono.create】お振込確認依頼を受け付けました',
      [
        'お振込のご連絡ありがとうございます。',
        '内容を確認次第、ご連絡いたします。',
        '',
        '▼ ご報告内容',
        'プラン: '    + (data.plan   || ''),
        '振込金額: '  + (data.amount || ''),
        '振込日: '    + (data.date   || ''),
        '',
        '通常、当日〜翌営業日中にご連絡いたします。',
        'ご不明な点はこのメールへご返信ください。',
      ]
    );
  }

  // ④ オーナーへのGmailバックアップ通知
  notifyOwnerEmail(
    '【LP振込報告】' + (data.name || '') + ' ¥' + (data.amount || ''),
    [
      '報告日時: '  + now,
      '振込名義: '  + (data.name    || ''),
      '連絡先: '    + (data.contact || '未入力'),
      'プラン: '    + (data.plan    || ''),
      '振込金額: '  + (data.amount  || ''),
      '振込日: '    + (data.date    || ''),
      '備考: '      + (data.note    || 'なし'),
      '',
      '▶ 管理画面で承認: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

// ── Chatwork通知 ──────────────────────────────────────────────
function notifyChatwork(data, now) {
  var msg = [
    '[To:' + CHATWORK_MENTION + '] 中村航汰',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '📩 新着お問い合わせ — mono.create LP',
    '━━━━━━━━━━━━━━━━━━━━',
    '受信日時：' + now,
    'お名前  ：' + (data.name || '未入力'),
    '会社名  ：' + (data.company || '未入力'),
    'メール  ：' + (data.email || '未入力'),
    'CW ID   ：' + (data.chatwork_id || '未入力'),
    'プラン  ：' + (data.plan || '未入力'),
    '',
    '【相談内容】',
    data.message || '',
    '━━━━━━━━━━━━━━━━━━━━',
    '管理画面: YOUR_ADMIN_URL',
  ].join('\n');

  var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
  UrlFetchApp.fetch(url, {
    method:  'post',
    headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
    payload: { body: msg }
  });
}

// ── ポートフォリオ操作 ────────────────────────────────────────
function listPortfolio() {
  var sheet = getOrCreatePortfolioSheet();
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue; // URL空はスキップ
    data.push({
      row:   i + 1,
      date:  row[0] || '',
      url:   row[1] || '',
      title: row[2] || '',
      genre: row[3] || '',
      type:  row[4] || 'ショート',
      order: row[5] || 99
    });
  }
  data.sort(function(a, b) { return (a.order - b.order) || (a.date < b.date ? 1 : -1); });
  return jsonResponse({ data: data });
}

function addPortfolio(data) {
  var sheet = getOrCreatePortfolioSheet();
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  var count = sheet.getLastRow() - 1;
  sheet.appendRow([now, data.url || '', data.title || '', data.genre || '', data.type || 'ショート', count + 1]);
  return jsonResponse({ success: true });
}

function updatePortfolio(data) {
  var row = parseInt(data.row, 10);
  if (!row) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreatePortfolioSheet();
  sheet.getRange(row, 2).setValue(data.url   || '');
  sheet.getRange(row, 3).setValue(data.title || '');
  sheet.getRange(row, 4).setValue(data.genre || '');
  sheet.getRange(row, 5).setValue(data.type  || 'ショート');
  sheet.getRange(row, 6).setValue(data.order || 99);
  return jsonResponse({ success: true });
}

function deletePortfolio(row) {
  if (!row) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreatePortfolioSheet();
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ── ヘルパー ─────────────────────────────────────────────────
function getOrCreateSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['受信日時', 'お名前', '会社名', 'メール', 'CW ID', 'プラン', '相談内容', 'ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  return sheet;
}

function getOrCreatePortfolioSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('portfolio');
  if (!sheet) {
    sheet = ss.insertSheet('portfolio');
    sheet.appendRow(['追加日時', 'URL', 'タイトル', 'ジャンル', 'タイプ', '表示順']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return sheet;
}

// ================================================================
// 契約同意記録
// ================================================================
function saveContract(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) {
    sheet = ss.insertSheet('contracts');
    sheet.appendRow(['同意日時', 'お名前', 'メールアドレス', 'プラン', '契約バージョン', 'IPメモ']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([
    now,
    data.name        || '',
    data.email       || '',
    data.plan        || '',
    data.contractVer || '',
    ''
  ]);

  // Chatwork通知
  if (CHATWORK_ROOM_ID) {
    var msg = [
      '[To:' + CHATWORK_MENTION + '] 中村航汰',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '📝 契約同意完了 — mono.create LP',
      '━━━━━━━━━━━━━━━━━━━━',
      '同意日時：' + now,
      'お名前  ：' + (data.name  || ''),
      'メール  ：' + (data.email || ''),
      'プラン  ：' + (data.plan  || ''),
      '━━━━━━━━━━━━━━━━━━━━',
      '▶ 次のヒアリングシート回答をお待ちください。',
    ].join('\n');
    var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
    UrlFetchApp.fetch(url, { method:'post', headers:{'X-ChatWorkToken':CHATWORK_TOKEN}, payload:{body:msg} });
  }

  // ② お客様への自動返信メール
  sendAutoReply(data.email, data.name,
    '【mono.create】ご契約同意を確認しました',
    [
      'ご契約内容への同意ありがとうございます。',
      '確認いたしました。',
      '',
      '引き続きヒアリングシートへのご記入をお願いいたします。',
      '担当者よりヒアリングシートのURLをお送りします。',
      '',
      'ご不明な点はこのメールへご返信ください。',
    ]
  );

  // ② オーナーへのGmailバックアップ通知
  notifyOwnerEmail(
    '【LP契約同意】' + (data.name || '') + ' — ' + (data.plan || ''),
    [
      '同意日時: ' + now,
      'お名前: '  + (data.name  || ''),
      'メール: '  + (data.email || '未入力'),
      'プラン: '  + (data.plan  || ''),
      '契約バージョン: ' + (data.contractVer || ''),
      '',
      '▶ ヒアリングシートURLを送付してください。',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

function listContracts() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    data.push({ row: i+1, date: row[0]||'', name: row[1]||'', email: row[2]||'', plan: row[3]||'', ver: row[4]||'' });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// ================================================================
// ヒアリングシート
// ================================================================
function saveHearing(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) {
    sheet = ss.insertSheet('hearings');
    sheet.appendRow(['受信日時','お名前','メール','プラン','回答JSON','ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.name  || '',
    data.email || '',
    data.plan  || '',
    JSON.stringify(data.answers || {}),
    '未対応'
  ]);

  // Chatwork通知
  if (CHATWORK_ROOM_ID) {
    var lines = ['[To:' + CHATWORK_MENTION + '] 中村航汰', '',
      '━━━━━━━━━━━━━━━━━━━━',
      '📋 ヒアリングシート回答 — mono.create LP',
      '━━━━━━━━━━━━━━━━━━━━',
      '受信日時：' + now,
      'お名前  ：' + (data.name  || ''),
      'メール  ：' + (data.email || ''),
      'プラン  ：' + (data.plan  || ''),
      '━━━━━━━━━━━━━━━━━━━━'
    ];
    var ans = data.answers || {};
    Object.keys(ans).forEach(function(k){ lines.push(k + '：' + ans[k]); });
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
    UrlFetchApp.fetch(url, { method:'post', headers:{'X-ChatWorkToken':CHATWORK_TOKEN}, payload:{body:lines.join('\n')} });
  }

  // ③ お客様への自動返信メール
  sendAutoReply(data.email, data.name,
    '【mono.create】ヒアリングシートを受け付けました',
    [
      'ヒアリングシートへのご記入ありがとうございます。',
      '内容を確認のうえ、2〜3営業日以内にお見積もりをお送りいたします。',
      '',
      '▼ ご回答いただいたプラン: ' + (data.plan || ''),
      '',
      'ご不明な点はこのメールへご返信ください。',
    ]
  );

  // ③ オーナーへのGmailバックアップ通知
  var answerLines = [];
  var ans2 = data.answers || {};
  Object.keys(ans2).forEach(function(k){ answerLines.push(k + ': ' + ans2[k]); });
  notifyOwnerEmail(
    '【LPヒアリング】' + (data.name || '') + ' — ' + (data.plan || ''),
    [
      '受信日時: ' + now,
      'お名前: '  + (data.name  || ''),
      'メール: '  + (data.email || '未入力'),
      'プラン: '  + (data.plan  || ''),
      '',
      '【回答内容】',
    ].concat(answerLines).concat([
      '',
      '▶ お見積もりを送付してください。',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ])
  );

  return jsonResponse({ success: true });
}

function listHearings() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var answers = {};
    try { answers = JSON.parse(row[4]); } catch(e) {}
    data.push({ row:i+1, date:row[0]||'', name:row[1]||'', email:row[2]||'', plan:row[3]||'', answers:answers, status:row[5]||'未対応' });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// ================================================================
// 売上帳（青色申告対応）
// 帳簿種別: 売上帳・経費帳
// ================================================================
function saveSales(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('uriage');
  if (!sheet) {
    sheet = ss.insertSheet('uriage');
    // 青色申告・売上帳フォーマット
    sheet.appendRow(['取引日','取引先名','取引先住所','摘要（プラン）','売上金額（税抜）','消費税額','売上金額（税込）','入金日','入金確認','備考']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 200);
    sheet.setColumnWidth(5, 120);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 120);
    sheet.setColumnWidth(8, 100);
    sheet.setColumnWidth(9, 80);
    sheet.setColumnWidth(10, 200);
  }

  var taxInc   = parseFloat(data.amount) || 0;
  var taxRate  = 0.10;
  var taxExc   = Math.round(taxInc / (1 + taxRate));
  var taxAmt   = taxInc - taxExc;

  sheet.appendRow([
    data.date        || '',   // 取引日
    data.client      || '',   // 取引先名
    data.address     || '',   // 取引先住所
    data.plan        || '',   // 摘要
    taxExc,                   // 売上金額（税抜）
    taxAmt,                   // 消費税額
    taxInc,                   // 売上金額（税込）
    data.payDate     || '',   // 入金日
    data.confirmed   || '未確認', // 入金確認
    data.note        || ''    // 備考
  ]);
  return jsonResponse({ success: true });
}

function listSales() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('uriage');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    data.push({
      row:       i+1,
      date:      row[0]||'',
      client:    row[1]||'',
      plan:      row[3]||'',
      taxExc:    row[4]||0,
      taxAmt:    row[5]||0,
      taxInc:    row[6]||0,
      payDate:   row[7]||'',
      confirmed: row[8]||'未確認',
      note:      row[9]||''
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// ── 振込報告一覧 ──────────────────────────────────────────────
function listPayments() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('payments');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    data.push({
      row:     i + 1,
      date:    row[0] || '',
      name:    row[1] || '',
      contact: row[2] || '',
      plan:    row[3] || '',
      amount:  row[4] || '',
      payDate: row[5] || '',
      note:    row[6] || '',
      status:  row[7] || '入金確認待ち'
    });
  }
  data.sort(function(a, b) { return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// ── 振込承認 → 売上帳に自動記帳 ─────────────────────────────
function approvePayment(row) {
  if (!row || isNaN(row)) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('payments');
  if (!sheet) return jsonResponse({ error: 'payments sheet not found' });

  // 対象行のデータ取得
  var values  = sheet.getRange(row, 1, 1, 8).getValues()[0];
  var name      = values[1] || '';
  var plan      = values[3] || '';
  var amountStr = (values[4] || '').toString();
  var payDate   = values[5] || '';
  var note      = values[6] || '';

  // すでに承認済みならスキップ
  if (values[7] === '承認済み') {
    return jsonResponse({ error: 'already_approved' });
  }

  // ステータスを承認済みに更新
  sheet.getRange(row, 8).setValue('承認済み');

  // 金額をパース（例: "¥49,800" → 49800）
  var taxInc = parseInt(amountStr.replace(/[^0-9]/g, ''), 10) || 0;
  var taxExc = Math.round(taxInc / 1.1);
  var taxAmt = taxInc - taxExc;

  // 売上帳（uriage）に記帳
  var uriage = ss.getSheetByName('uriage');
  if (!uriage) {
    uriage = ss.insertSheet('uriage');
    uriage.appendRow(['取引日','取引先名','取引先住所','摘要（プラン）','売上金額（税抜）','消費税額','売上金額（税込）','入金日','入金確認','備考']);
    uriage.setFrozenRows(1);
    uriage.getRange(1,1,1,10).setFontWeight('bold');
  }
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  uriage.appendRow([
    today,        // 取引日
    name,         // 取引先名
    '',           // 取引先住所
    plan,         // 摘要（プラン）
    taxExc,       // 売上金額（税抜）
    taxAmt,       // 消費税額
    taxInc,       // 売上金額（税込）
    payDate,      // 入金日
    '確認済み',   // 入金確認
    note          // 備考
  ]);

  // ⑤ お客様へ入金確認メール（contactがメールアドレスの場合）
  var contact = values[2] || '';
  if (isEmail(contact)) {
    sendAutoReply(contact, name,
      '【mono.create】お振込を確認しました ／ 制作開始のお知らせ',
      [
        'お振込を確認いたしました。',
        '本日より制作を開始いたします。',
        '',
        '▼ ご契約内容',
        'プラン: '    + plan,
        '金額（税込）: ¥' + taxInc.toLocaleString(),
        '',
        '進捗は随時このメールにてご連絡いたします。',
        'ご質問はいつでもご返信ください。',
      ]
    );
  }

  return jsonResponse({ success: true, taxInc: taxInc, taxExc: taxExc });
}

// ================================================================
// ヒアリング案内メール送信
// ================================================================
function sendHearingLink(email, name, plan, planKey) {
  if (!email || email.indexOf('@') === -1) {
    return jsonResponse({ error: 'invalid email' });
  }

  // プランキーからヒアリングURLを決定
  var hearingPath = HEARING_MAP[planKey] || 'hearing/short.html';
  var hearingUrl  = LP_BASE_URL + hearingPath
    + '?name=' + encodeURIComponent(name)
    + '&email=' + encodeURIComponent(email)
    + '&plan='  + encodeURIComponent(plan || planKey);

  sendAutoReply(email, name,
    '【mono.create】次のステップのご案内',
    [
      'この度はmono.createをご検討いただきありがとうございます。',
      '以下のヒアリングシートへのご記入をお願いいたします。',
      '',
      '▼ ヒアリングシート（クリックして回答）',
      hearingUrl,
      '',
      '所要時間は約5分です。',
      'ご記入いただいた内容をもとに、お見積もりをお送りいたします。',
      '',
      'ご不明な点はこのメールへご返信ください。',
    ]
  );

  return jsonResponse({ success: true, hearingUrl: hearingUrl });
}

// ================================================================
// お見積もり・振込依頼メール送信
// ================================================================
function sendPaymentRequest(email, name, plan, amount, due, note) {
  if (!email || email.indexOf('@') === -1) {
    return jsonResponse({ error: 'invalid email' });
  }

  var taxInc = parseInt((amount + '').replace(/[^0-9]/g, ''), 10) || 0;
  var dueStr = due || '7日以内';

  // payment.html へのプリセットリンク
  var paymentUrl = LP_BASE_URL + 'payment.html'
    + '?name='   + encodeURIComponent(name)
    + '&email='  + encodeURIComponent(email)
    + '&plan='   + encodeURIComponent(plan)
    + '&amount=' + encodeURIComponent('¥' + taxInc.toLocaleString());

  sendAutoReply(email, name,
    '【mono.create】お見積もりのご案内',
    [
      'この度はmono.createをご利用いただきありがとうございます。',
      'お見積もりをお送りいたします。',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '▼ お見積もり内容',
      'プラン  ：' + plan,
      '合計金額：¥' + taxInc.toLocaleString() + '（税込）',
      '振込期限：' + dueStr,
      note ? ('備考    ：' + note) : '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      BANK_INFO,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '▼ お振込完了後、以下より振込完了をご連絡ください',
      paymentUrl,
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'ご不明な点はこのメールへご返信ください。',
      'ご依頼お待ちしております。',
    ].filter(function(l){ return l !== ''; })
  );

  return jsonResponse({ success: true });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

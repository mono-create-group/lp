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
var LP_BASE_URL       = 'https://mono-create-group.github.io/lp/';

// 素材アップロード用：親フォルダID（mono.create.group@gmail.comが所有）
// この親フォルダ配下にクライアントごとの専用サブフォルダを自動作成する
var MATERIAL_PARENT_FOLDER_ID = '1YdwuPGNqYQZiHeseuMtyXF2GKkyqmSvo';

// 契約書PDF保管用：親フォルダ配下に「_契約書PDF」サブフォルダを作成・使用
// 絶対に削除されないよう、専用フォルダで永久保管する
var CONTRACT_PDF_SUBFOLDER_NAME = '_契約書PDF';

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
  'trial':       'hearing/short.html',
  'short-single':'hearing/short.html',
  'edit-short':  'hearing/short.html',
  'long-single': 'hearing/long-single.html',
  'edit-long':   'hearing/set-long.html',
  'set-8':       'hearing/set-short.html',
  'set-10':      'hearing/set-short.html',
  'set-15':      'hearing/set-short.html',
  'set-30':      'hearing/set-short.html',
  'set-long':    'hearing/set-long.html',
  'mixed-std':   'hearing/ops-pack.html',
  'mixed-pre':   'hearing/ops-pack.html',
  'dispatch':    'hearing/dispatch.html',
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
  MailApp.sendEmail({
    to:      toEmail,
    subject: subject,
    body:    body,
    name:    'mono.create',
    replyTo: OWNER_EMAIL
  });
}

// オーナーへのGmail通知（Chatworkが届かない場合のバックアップ）
function notifyOwnerEmail(subject, lines) {
  var body = lines.join('\n');
  MailApp.sendEmail({ to: OWNER_EMAIL, subject: subject, body: body, name: 'mono.create LP' });
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

    // LP コンテンツ更新
    if (data.action === 'content_update') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return updateLpContent(data.content || {});
    }

    // サービス受付ステータス更新
    if (data.action === 'update_service_status') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return updateServiceStatus(data);
    }

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

    // 制作スケジュール追加（POST via URL?action=schedule_add）
    var qa = (e.parameter && e.parameter.action) || '';
    if (qa === 'schedule_add') {
      if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return addSchedule(data);
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
        '────────────────────────────',
        '📅 オンライン面談をご希望の方へ',
        '────────────────────────────',
        'ご希望の方は、下記リンクから面談可能な日程をお選びください。',
        'https://timerex.net/s/sutchiokapi_1fa4/2bc09803',
        '',
        '※ 予約フォームには、必ずこのお問い合わせに記載いただいたお名前をご入力ください。',
        '────────────────────────────',
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

  // サービス受付ステータス（LP側からも呼ばれるため認証不要）
  if (action === 'service_status') {
    return getServiceStatus();
  }

  // Google DriveファイルのURL→名前取得（管理者キー必須）
  if (action === 'drive_file_info') {
    if (key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return getDriveFileInfo(e.parameter.url || '');
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

  if (action === 'inquiry_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deleteInquiry(row);
  }

  if (action === 'payment_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deletePayment(row);
  }

  if (action === 'sales_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deleteSales(row);
  }

  if (action === 'contract_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deleteContract(row);
  }

  if (action === 'hearing_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deleteHearing(row);
  }

  if (action === 'update_hearing_status') {
    var row    = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updateHearingStatus(row, status);
  }

  if (action === 'set_trial') {
    var row       = parseInt(e.parameter.row, 10);
    var sheetName = e.parameter.sheet || 'inquiries';
    var value     = e.parameter.value || '';
    return setTrial(sheetName, row, value);
  }

  if (action === 'create_trial_folder') {
    var clientName = e.parameter.name || 'unknown';
    return jsonResponse(createClientMaterialFolder(clientName));
  }

  // ── 一括削除 ──
  if (action === 'clear_inquiries')  return clearSheet(SHEET_NAME);
  if (action === 'clear_payments')   return clearSheet('payments');
  if (action === 'clear_sales')      return clearSheet('uriage');
  if (action === 'clear_contracts')  return clearSheet('contracts');
  if (action === 'clear_hearings')   return clearSheet('hearings');

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

  // 制作スケジュール
  if (action === 'schedule_list') {
    return listSchedule();
  }
  if (action === 'schedule_status') {
    return updateScheduleStatus(parseInt(e.parameter.row, 10), e.parameter.status || '');
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

  // LP コンテンツ取得（認証不要 — LPから直接呼ばれる）
  if (action === 'content_get') {
    return getLpContent();
  }

  // LP コンテンツ更新（admin認証必須）
  if (action === 'content_update') {
    return jsonResponse({ error: 'use POST' });
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
      status:      row[7] || '未対応',
      trial:       row[8] || ''    // 'トライアル' or '' (9列目)
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

// ── ヒアリング ステータス更新 ────────────────────────────────────
function updateHearingStatus(row, status) {
  var allowed = ['未対応', '対応中', '完了'];
  if (!row || allowed.indexOf(status) === -1) {
    return jsonResponse({ error: 'invalid params' });
  }
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) return jsonResponse({ error: 'hearings sheet not found' });
  sheet.getRange(row, 6).setValue(status); // 6列目=ステータス
  return jsonResponse({ success: true });
}

// ── トライアルフラグ更新 ──────────────────────────────────────
function setTrial(sheetName, row, value) {
  // sheetName: 'inquiries' or 'hearings'
  // value: 'トライアル' or ''
  if (!row) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = sheetName === 'hearings' ? ss.getSheetByName('hearings') : getOrCreateSheet();
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  var col = sheetName === 'hearings' ? 7 : 9; // hearings:7列目, inquiries:9列目
  sheet.getRange(row, col).setValue(value || '');
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

function deleteContract(row) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteHearing(row) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ヘッダー行（1行目）を残してデータ行を全削除
function clearSheet(sheetName) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  return jsonResponse({ success: true });
}

function deletePayment(row) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('payments');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteSales(row) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('uriage');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteInquiry(row) {
  if (!row) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreateSheet(); // inquiries シート
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ── LP コンテンツ管理 ─────────────────────────────────────────
var LP_CONTENT_KEY = 'lp_content';

function getLpContent() {
  var props = PropertiesService.getScriptProperties();
  var json  = props.getProperty(LP_CONTENT_KEY) || '{}';
  return jsonResponse({ content: JSON.parse(json) });
}

function updateLpContent(content) {
  var props = PropertiesService.getScriptProperties();
  // 既存とマージして保存
  var existing = JSON.parse(props.getProperty(LP_CONTENT_KEY) || '{}');
  Object.keys(content).forEach(function(k) { existing[k] = content[k]; });
  props.setProperty(LP_CONTENT_KEY, JSON.stringify(existing));
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
// 制作スケジュール（納期管理）
// ================================================================

function _scheduleSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('schedule');
  if (!sheet) {
    sheet = ss.insertSheet('schedule');
    sheet.appendRow(['登録日時','クライアント','素材・動画','初稿納期','最終納品','担当','ステータス','メモ']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,8).setFontWeight('bold');
  }
  return sheet;
}

function listSchedule() {
  var sheet = _scheduleSheet();
  var vals = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    data.push({
      row: i+1,
      createdAt: r[0]||'',
      client: r[1]||'',
      title: r[2]||'',
      deadlineDraft: r[3] instanceof Date ? Utilities.formatDate(r[3], 'Asia/Tokyo','yyyy-MM-dd') : (r[3]||''),
      deadlineFinal: r[4] instanceof Date ? Utilities.formatDate(r[4], 'Asia/Tokyo','yyyy-MM-dd') : (r[4]||''),
      assignee: r[5]||'',
      status: r[6]||'未着手',
      note: r[7]||'',
    });
  }
  return jsonResponse({ data: data });
}

function addSchedule(data) {
  var sheet = _scheduleSheet();
  var now = Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.client||'',
    data.title||'',
    data.deadlineDraft||'',
    data.deadlineFinal||'',
    data.assignee||'',
    data.status||'未着手',
    data.note||''
  ]);
  return jsonResponse({ success:true });
}

function updateScheduleStatus(row, status) {
  if (!row || !status) return jsonResponse({ error:'invalid' });
  var sheet = _scheduleSheet();
  var vals = sheet.getRange(row, 1, 1, 8).getValues()[0];
  sheet.getRange(row, 7).setValue(status);
  return jsonResponse({ success:true });
}

// ================================================================
// 契約書PDF保管フォルダ取得（無ければ作成）
// ================================================================
function getContractPdfFolder() {
  var parent = DriveApp.getFolderById(MATERIAL_PARENT_FOLDER_ID);
  var found  = parent.getFoldersByName(CONTRACT_PDF_SUBFOLDER_NAME);
  if (found.hasNext()) return found.next();
  // 新規作成（オーナーのみ閲覧可：後でアクセス権を絞る）
  var folder = parent.createFolder(CONTRACT_PDF_SUBFOLDER_NAME);
  folder.setDescription('業務委託契約書PDFの永久保管庫 / DO NOT DELETE');
  return folder;
}

// ================================================================
// 契約書PDFを生成して保管（DocumentApp 経由）
// 戻り値: { pdfFile, pdfUrl, pdfId }
// ================================================================
function generateContractPdf(data, agreedAt) {
  // 1) 一時 Google Doc を作成
  var docTitle = '【契約書】' + (data.name || 'unknown') + '_' +
                 Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var doc  = DocumentApp.create(docTitle);
  var body = doc.getBody();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(40).setMarginRight(40);

  // ── ヘッダー ──
  body.appendParagraph('業務委託契約書')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('動画制作・SNS運用支援')
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(10).setForegroundColor('#555555');
  body.appendParagraph(' ');

  // ── 当事者情報 ──
  var amt = data.amount ? ('¥' + Number(data.amount).toLocaleString()) : '(別途お見積もり)';
  var partyTable = body.appendTable([
    ['同意日時',       agreedAt],
    ['委託者（甲）',   data.name  || ''],
    ['メールアドレス', data.email || ''],
    ['受託者（乙）',   '中村 航汰 / mono.create'],
    ['プラン',         data.plan  || ''],
    ['金額（税込）',   amt],
    ['契約バージョン', data.contractVer || 'v2025-05'],
  ]);
  partyTable.getRow(0).editAsText().setBold(true);
  for (var i = 0; i < 7; i++) {
    var cell = partyTable.getCell(i, 0);
    cell.setBackgroundColor('#F3F4F6');
    cell.editAsText().setBold(true).setFontSize(10);
  }
  body.appendParagraph(' ');

  // ── 契約条文（全17条）──
  var articles = [
    ['第1条（目的）',
      ['本契約は、甲が乙に対して動画制作・編集・SNS運用支援に関する業務を委託し、乙がこれを受託することを目的とします。']],
    ['第2条（業務内容）',
      ['選択プランに基づく動画編集・制作業務',
       'SNSへの投稿代行（該当プランのみ）',
       'アカウント分析・市場分析レポートの作成（該当プランのみ）',
       'その他、両者が個別に合意した付随業務']],
    ['第3条（委託料および支払方法）',
      ['委託料は選択プランおよびお見積もりメールに記載の金額とします',
       'ショート動画プランは前払い。長尺動画プラン（編集のみ）は納品後の後払いとします',
       '振込期限は請求書受領後3日以内とします',
       '振込手数料は甲のご負担とします',
       '期日を超過した場合、年利14.6%の遅延損害金が発生します']],
    ['第4条（無料トライアルについて）',
      ['初回1本は無料トライアルとして制作します（全プラン対象）',
       'トライアル完了後、甲が継続を希望しない場合は費用は一切発生しません',
       'トライアル作品の著作権は、甲が継続契約を締結した場合に限り甲へ移転します',
       'トライアルを悪用した複数回の申込みはお断りします']],
    ['第5条（素材の提供）',
      ['甲は業務に必要な素材を、乙がGoogle Driveに用意するクライアント様専用フォルダ（入金確認後にメールで案内）にて提供するものとします',
       '素材提供は入金確認後に行ってください（先払いプランの場合）',
       '甲が提供した素材について、第三者の著作権・肖像権・プライバシー権等を侵害しないよう甲が責任を負います',
       '違法・公序良俗に反するコンテンツの制作依頼はお断りします']],
    ['第6条（検収・修正）',
      ['成果物の納品後、甲は5営業日以内に確認・検収を行うものとします',
       '期間内に指摘がない場合は検収完了とみなします',
       '甲都合の修正は1本につき3回まで無料。4回目以降はショート動画¥1,000/回、長尺動画¥3,000/回を申し受けます',
       '乙側の誤り・認識相違による修正は回数に関わらず無料で対応します',
       '修正とは細部の調整を指し、方向性の大幅な変更は別途見積もりとします']],
    ['第7条（著作権の帰属）',
      ['成果物の著作権は、委託料の完済確認後に乙から甲へ移転します',
       '完済前の無断使用・公開・転用は禁止します',
       '乙は制作実績として成果物をポートフォリオ・SNS等に掲載できるものとします（甲が書面により拒否した場合を除く）',
       '甲が提供した素材の著作権は甲に帰属します']],
    ['第8条（アカウント情報の管理）',
      ['甲が提供したSNSアカウントのログイン情報は本業務の目的にのみ使用します',
       '乙は当該情報を暗号化して管理し、第三者に開示しません',
       '投稿代行を行う場合、投稿内容は事前に甲の確認を得た上で実施します',
       '乙によるアカウント操作に起因する不測の事態（凍結等）について、故意・重過失がない限り乙は責任を負いません']],
    ['第9条（秘密保持）',
      ['両者は本契約の履行に際して知り得た相手方の技術上・営業上その他一切の情報を秘密として保持します',
       '相手方の事前の書面による承諾なく第三者に開示・漏洩してはなりません',
       '本条の義務は契約終了後3年間継続します',
       '法令・裁判所の命令による開示は除きます']],
    ['第10条（免責事項）',
      ['乙はSNSプラットフォームのアルゴリズム変更・仕様変更・規約変更による影響に責任を負いません',
       '再生数・フォロワー数・エンゲージメント等の成果について特定の結果を保証しません',
       '不可抗力（天災・通信障害・システム障害等）による業務遅延・不能については双方免責とします',
       '甲が提供した素材の権利関係に問題があった場合、乙は責任を負いません']],
    ['第11条（禁止事項）',
      ['成果物の完済前における無断使用・第三者への転売・再配布',
       '乙の名誉・信用を傷つける行為',
       '本契約に基づく権利・義務の第三者への譲渡（乙の書面承諾なく）',
       '違法・公序良俗に反するコンテンツへの使用']],
    ['第12条（契約期間および更新）',
      ['本契約の有効期間は締結日から1ヶ月間とします',
       '期間満了の7日前までに両者いずれからも解約の申し出がない場合、同条件で1ヶ月間自動更新します',
       '自動更新は最大12回（計1年間）を上限とします。それ以降は改めて協議のうえ更新します']],
    ['第13条（解約・解除）',
      ['甲は月末7日前までに書面または電子メールで申し出ることにより、翌月末をもって解約できます',
       '乙は次の事由に該当する場合、即時解除できます：(ア)支払期日から14日以上の延滞 (イ)本契約の重大な違反 (ウ)反社会的勢力への該当が判明した場合',
       '解除の場合、乙は既に完了した業務分の委託料を請求できます',
       '解約・解除後、甲はアカウント情報のパスワードを変更するものとします']],
    ['第14条（損害賠償の制限）',
      ['乙の債務不履行・不法行為による損害賠償額は、当該月の委託料を上限とします',
       'ただし乙の故意・重過失による場合はこの限りではありません',
       '間接損害・特別損害・逸失利益については、乙は責任を負いません']],
    ['第15条（反社会的勢力の排除）',
      ['両者は、現在および将来にわたり、暴力団・暴力団員・暴力団関係企業その他反社会的勢力に該当しないことを表明・保証します。該当が判明した場合、相手方は何ら通知なく本契約を即時解除できます。']],
    ['第16条（協議解決）',
      ['本契約に定めのない事項または解釈に疑義が生じた場合、両者は誠意をもって協議し解決を図るものとします。']],
    ['第17条（準拠法・合意管轄）',
      ['本契約は日本法に準拠します。本契約に関する紛争については、乙の所在地を管轄する裁判所を第一審の専属合意管轄裁判所とします。']],
  ];

  articles.forEach(function(art) {
    var h = body.appendParagraph(art[0]);
    h.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    h.editAsText().setForegroundColor('#1E40AF');
    art[1].forEach(function(line) {
      if (art[1].length === 1) {
        body.appendParagraph(line).editAsText().setFontSize(10);
      } else {
        body.appendListItem(line)
            .setGlyphType(DocumentApp.GlyphType.BULLET)
            .editAsText().setFontSize(10);
      }
    });
    body.appendParagraph(' ');
  });

  // ── 同意確認・電子署名 ──
  body.appendParagraph('━━━━━━━━━━━━━━━━━━━━')
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setForegroundColor('#9CA3AF');
  body.appendParagraph('電子的同意の記録')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(
    '甲（' + (data.name || '') + '）は、上記契約全17条の内容を確認し、' +
    agreedAt + ' に同意の意思表示を行いました。'
  ).editAsText().setFontSize(10);
  body.appendParagraph(
    '本契約は電子署名（同意ボタン押下）をもって成立し、双方が本PDFを保管します。'
  ).editAsText().setFontSize(10).setItalic(true);
  body.appendParagraph(' ');
  body.appendParagraph('受託者：中村 航汰 / mono.create')
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(10);

  doc.saveAndClose();

  // 2) PDFに変換
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs(MimeType.PDF);
  pdfBlob.setName(docTitle + '.pdf');

  // 3) 専用フォルダに保管
  var contractFolder = getContractPdfFolder();
  var pdfFile = contractFolder.createFile(pdfBlob);
  pdfFile.setDescription(
    '業務委託契約書 / 委託者: ' + (data.name || '') +
    ' / 同意日時: ' + agreedAt +
    ' / DO NOT DELETE'
  );

  // 4) 一時Docはゴミ箱へ
  docFile.setTrashed(true);

  return {
    pdfFile: pdfFile,
    pdfId:   pdfFile.getId(),
    pdfUrl:  pdfFile.getUrl(),
    pdfName: docTitle + '.pdf',
  };
}

// ================================================================
// 契約同意記録
// ================================================================
function saveContract(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) {
    sheet = ss.insertSheet('contracts');
    sheet.appendRow(['同意日時', 'お名前', 'メールアドレス', 'プラン', '契約バージョン', 'ステージ', 'PDF URL']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  var stage = data.stage || 'inquiry';

  // ★ 支払い直前ステージのみ、契約書PDF を生成して永久保管
  var pdfResult = null;
  if (stage === 'pre-payment') {
    try {
      pdfResult = generateContractPdf(data, now);
    } catch(err) {
      Logger.log('PDF生成失敗: ' + err);
    }
  }

  sheet.appendRow([
    now,
    data.name        || '',
    data.email       || '',
    data.plan        || '',
    data.contractVer || '',
    stage,
    pdfResult ? pdfResult.pdfUrl : ''
  ]);

  // Chatwork通知（ステージで分岐）
  if (CHATWORK_ROOM_ID) {
    var msg;
    if (stage === 'pre-payment') {
      msg = [
        '[To:' + CHATWORK_MENTION + '] 中村航汰',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '📝 業務委託契約 締結完了 — mono.create',
        '━━━━━━━━━━━━━━━━━━━━',
        '締結日時：' + now,
        'お名前  ：' + (data.name  || ''),
        'メール  ：' + (data.email || ''),
        'プラン  ：' + (data.plan  || ''),
        '金額    ：' + (data.amount ? '¥' + Number(data.amount).toLocaleString() : '(別途)'),
        '━━━━━━━━━━━━━━━━━━━━',
        '▶ 契約書PDFを永久保管しました：',
        '  ' + (pdfResult ? pdfResult.pdfUrl : '(生成失敗)'),
        '▶ お客様にもPDF添付でメール送付済み',
      ].join('\n');
    } else {
      msg = [
        '[To:' + CHATWORK_MENTION + '] 中村航汰',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '📨 お問い合わせ受付 — mono.create LP',
        '━━━━━━━━━━━━━━━━━━━━',
        '受付日時：' + now,
        'お名前  ：' + (data.name  || ''),
        'メール  ：' + (data.email || ''),
        'プラン  ：' + (data.plan  || ''),
        '━━━━━━━━━━━━━━━━━━━━',
        '▶ ヒアリングシートURLは自動でお送り済みです。',
        '▶ 回答がスプレッドシートに届くまでお待ちください。',
      ].join('\n');
    }
    var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
    UrlFetchApp.fetch(url, { method:'post', headers:{'X-ChatWorkToken':CHATWORK_TOKEN}, payload:{body:msg} });
  }

  // ② お客様への自動返信メール（ステージで分岐）
  if (stage === 'pre-payment') {
    // 契約締結メール（PDF添付）
    var amtTxt = data.amount ? '¥' + Number(data.amount).toLocaleString() : '(別途お見積もり)';
    var contractBody = [
      (data.name || '') + ' 様',
      '',
      '業務委託契約書の全条項にご同意いただきありがとうございます。',
      '本メール送信時点で、業務委託契約が正式に締結いたしました。',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '▼ 契約内容',
      '━━━━━━━━━━━━━━━━━━━━',
      '締結日時: ' + now,
      'プラン  : ' + (data.plan   || ''),
      '金額    : ' + amtTxt,
      'バージョン: ' + (data.contractVer || 'v2025-05'),
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '▼ 契約書PDFについて',
      '━━━━━━━━━━━━━━━━━━━━',
      'このメールに業務委託契約書のPDFを添付しています。',
      '双方の控えとして大切に保管をお願いいたします。',
      '※ 弊社（mono.create）側でもDriveに永久保管しております。',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '▼ 次のステップ：お振込',
      '━━━━━━━━━━━━━━━━━━━━',
      'お振込先・期限は別途お送りしているお見積もりメール／',
      '振込案内ページに記載しております。',
      '',
      'ご入金確認後、素材アップロード用の専用Driveフォルダを',
      '自動でご案内いたします。',
      '',
      'ご質問はこのメールへご返信ください。',
      '担当：中村 航汰（mono.create）',
    ];
    if (pdfResult) {
      MailApp.sendEmail({
        to: data.email,
        subject: '【mono.create】業務委託契約 締結のお知らせ ／ 契約書PDFご送付',
        body: contractBody.join('\n'),
        name: 'mono.create',
        attachments: [pdfResult.pdfFile.getBlob()],
      });
    } else {
      sendAutoReply(data.email, data.name,
        '【mono.create】業務委託契約 締結のお知らせ',
        contractBody.slice(2));  // slice(2): 先頭の「名前 様」と空行を除去（sendAutoReplyがgreetingを自動付加するため）
    }
  } else {
    // お問い合わせ受付メール（ヒアリングシートURL案内）
    var hearingUrl = data.hearingUrl || '';
    sendAutoReply(data.email, data.name,
      '【mono.create】お問い合わせを受け付けました — ヒアリングシートのご案内',
      [
        'この度はmono.createにお問い合わせいただきありがとうございます。',
        'ご選択いただいたプラン：' + (data.plan || ''),
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ 次のステップ：ヒアリングシートのご記入',
        '━━━━━━━━━━━━━━━━━━━━',
        '以下のURLからヒアリングシートにご回答ください（5〜10分程度）。',
        'お客様のご要望に合わせた正式なお見積もりをご案内いたします。',
        '',
        hearingUrl,
        '',
        '※ 上記URLにはお名前・メールアドレス・プラン名が自動入力されています。',
        '※ このメールに返信して直接ご質問いただくことも可能です。',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ 今後の流れ',
        '━━━━━━━━━━━━━━━━━━━━',
        '1️⃣ ヒアリングシートにご回答',
        '2️⃣ 内容を確認のうえ、正式なお見積もりをメール送付',
        '3️⃣ ご納得いただけたら業務委託契約締結＋お支払い',
        '4️⃣ 制作スタート',
        '',
        'ご不明な点は、このメールへ直接ご返信ください。',
        '担当：中村 航汰（mono.create）',
      ]
    );
  }

  // ③ オーナーへのGmailバックアップ通知（ステージで件名分岐）
  var ownerSubject = (stage === 'pre-payment')
    ? '【契約締結＋PDF保管】' + (data.name || '') + ' — ' + (data.plan || '')
    : '【LP問い合わせ】' + (data.name || '') + ' — ' + (data.plan || '');
  notifyOwnerEmail(
    ownerSubject,
    (stage === 'pre-payment') ? [
      '締結日時: ' + now,
      'お名前: '   + (data.name  || ''),
      'メール: '   + (data.email || '未入力'),
      'プラン: '   + (data.plan  || ''),
      '金額: '     + (data.amount ? '¥' + Number(data.amount).toLocaleString() : '(別途)'),
      '契約バージョン: ' + (data.contractVer || ''),
      '',
      '▶ 契約書PDF: ' + (pdfResult ? pdfResult.pdfUrl : '(生成失敗)'),
      '▶ ファイル名: '  + (pdfResult ? pdfResult.pdfName : '-'),
      '▶ PDFはお客様にも添付メールで送付済み',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ] : [
      '同意日時: ' + now,
      'お名前: '  + (data.name  || ''),
      'メール: '  + (data.email || '未入力'),
      'プラン: '  + (data.plan  || ''),
      '契約バージョン: ' + (data.contractVer || ''),
      '',
      '▶ ヒアリングシートURLは自動送付済みです。',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({
    success: true,
    stage: stage,
    pdfUrl: pdfResult ? pdfResult.pdfUrl : null,
  });
}

function listContracts() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    data.push({ row: i+1, date: row[0]||'', name: row[1]||'', email: row[2]||'', plan: row[3]||'', ver: row[4]||'', stage: row[5]||'', pdfUrl: row[6]||'' });
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
    data.push({ row:i+1, date:row[0]||'', name:row[1]||'', email:row[2]||'', plan:row[3]||'', answers:answers, status:row[5]||'未対応', trial:row[6]||'' });
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
  // Date オブジェクトの場合は文字列に正規化（"yyyy/MM/dd"形式）
  data.forEach(function(d) {
    if (d.date instanceof Date) {
      d.date = Utilities.formatDate(d.date, 'Asia/Tokyo', 'yyyy/MM/dd');
    } else if (d.date) {
      // "2026-05-24" → "2026/05/24" に統一
      d.date = String(d.date).replace(/-/g, '/').split('T')[0];
    }
    // taxInc / taxExc / taxAmt を数値に確実変換
    d.taxInc = Number(d.taxInc) || 0;
    d.taxExc = Number(d.taxExc) || 0;
    d.taxAmt = Number(d.taxAmt) || 0;
  });
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
// ================================================================
// クライアント専用 素材アップロードフォルダを Google Drive に作成
// ================================================================
// - 親フォルダ (MATERIAL_PARENT_FOLDER_ID) 配下に
//   「YYYY-MM-DD_お名前」のサブフォルダを作成
// - 「リンクを知っている全員が編集可」に設定 → アップロードが可能
// - 共有URLを返す
function createClientMaterialFolder(clientName) {
  try {
    var parent = DriveApp.getFolderById(MATERIAL_PARENT_FOLDER_ID);
    var dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var folderName = dateStr + '_' + (clientName || 'unknown');

    // 既存の同名フォルダがあれば再利用、なければ新規作成
    var existing = parent.getFoldersByName(folderName);
    var folder;
    if (existing.hasNext()) {
      folder = existing.next();
    } else {
      folder = parent.createFolder(folderName);
    }

    // リンクを知っている全員に編集権限を付与（アップロード可能にする）
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    } catch(e) {
      Logger.log('共有権限設定エラー: ' + e);
    }

    return {
      success: true,
      url: folder.getUrl(),
      name: folderName,
      id: folder.getId()
    };
  } catch(err) {
    Logger.log('フォルダ作成失敗: ' + err);
    return { success: false, error: String(err) };
  }
}

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

  // ⑤ クライアント専用の素材アップロード用Driveフォルダを自動作成
  var folderResult = createClientMaterialFolder(name);
  var folderUrl  = folderResult.success ? folderResult.url  : '';
  var folderName = folderResult.success ? folderResult.name : '';

  // ⑥ お客様へ入金確認メール（contactがメールアドレスの場合）
  var contact = values[2] || '';
  if (isEmail(contact)) {
    var bodyLines = [
      'お振込を確認いたしました。誠にありがとうございます。',
      '本日より制作を開始いたします。',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '▼ ご契約内容',
      '━━━━━━━━━━━━━━━━━━━━',
      'プラン: '            + plan,
      '金額（税込）: ¥'      + taxInc.toLocaleString(),
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '📦 素材アップロードのお願い',
      '━━━━━━━━━━━━━━━━━━━━',
    ];
    if (folderUrl) {
      bodyLines = bodyLines.concat([
        '以下、' + name + ' 様 専用のアップロードフォルダをご用意しました。',
        '動画素材・音声素材・テロップ用画像など、編集に必要なファイルを',
        'こちらにアップロードしてください。',
        '',
        '▶ 専用フォルダURL：',
        folderUrl,
        '',
        '※ フォルダ名：' + folderName,
        '※ リンクをお持ちの方は、誰でもアップロード（編集）が可能です',
        '※ アップロード完了後、Chatworkまたはメールにてご一報ください',
      ]);
    } else {
      bodyLines = bodyLines.concat([
        '素材アップロード先のフォルダURLは、別途メールにてお送りします。',
        '少々お待ちください。',
      ]);
    }
    bodyLines = bodyLines.concat([
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '▼ 今後の流れ',
      '━━━━━━━━━━━━━━━━━━━━',
      '1. 素材をGoogle Driveにアップロード',
      '2. アップロード完了をご連絡（Chatwork または このメールへ返信）',
      '3. 制作スタート（通常2〜3営業日）',
      '4. 初稿納品 → 修正対応（3回まで無料）',
      '5. 完成・お引き渡し',
      '',
      'ご質問はいつでもこのメールへご返信ください。',
      '担当：中村 航汰（mono.create）',
    ]);
    sendAutoReply(contact, name,
      '【mono.create】お振込確認 ／ 素材アップロードフォルダのご案内',
      bodyLines
    );
  }

  // ⑦ オーナー通知
  notifyOwnerEmail(
    '【入金承認＆フォルダ作成】' + name + ' — ' + plan,
    [
      '取引日: '       + today,
      'お名前: '       + name,
      '連絡先: '       + contact,
      'プラン: '       + plan,
      '金額（税込）: ¥' + taxInc.toLocaleString(),
      'フォルダURL: '  + (folderUrl || '(作成失敗)'),
      'フォルダ名: '   + (folderName || '-'),
    ]
  );

  return jsonResponse({
    success: true,
    taxInc: taxInc,
    taxExc: taxExc,
    folderUrl: folderUrl,
    folderName: folderName,
  });
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
    + '?name='    + encodeURIComponent(name)
    + '&email='   + encodeURIComponent(email)
    + '&plan='    + encodeURIComponent(plan || planKey)
    + '&planKey=' + encodeURIComponent(planKey);

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

// ================================================================
// Gmail認証テスト（GASエディターで一度だけ手動実行してください）
// 実行後は削除不要。スコープが承認されます。
// ================================================================
function authorizeGmail() {
  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: '【mono.create GAS】メール送信の認証完了',
    body:    'GASからのメール送信が正常に認証されました。\n\nこのメールが届いていれば設定完了です。',
    name:    'mono.create GAS'
  });
  Logger.log('MailApp認証・テストメール送信完了: ' + OWNER_EMAIL);
}

// ================================================================
// Google Drive ファイル情報取得
// ================================================================
function getDriveFileInfo(url) {
  try {
    var m = url.match(/\/file\/d\/([^/?#]+)/);
    if (!m) return jsonResponse({ error: 'invalid drive url' });
    var fileId = m[1];
    var file = DriveApp.getFileById(fileId);
    return jsonResponse({
      name: file.getName(),
      thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400-h225'
    });
  } catch(e) {
    return jsonResponse({ error: e.message });
  }
}

// ================================================================
// サービス受付ステータス管理
// ScriptProperties に JSON で保存: { "edit_long": true/false, ... }
// true = 受付中, false = 受付停止中
// ================================================================

// デフォルト値（初回アクセス時）: true=受付中 / false=停止中
var SERVICE_DEFAULTS = {
  'edit_short':        true,   // ショート動画編集
  'edit_long':         false,  // 長尺動画編集（停止中）
  'consulting':        true,   // 編集コンサルティング
  'manual':            true,   // 編集マニュアル作成
  'same_day':          true,   // 当日納品
  'analysis':          true,   // アカウント分析
  'market':            true,   // 市場分析
  'posting':           true,   // 投稿代行
  'pack_short':        true,   // まとめて編集プラン（ショート）
  'pack_manage_short': true,   // 運用まるごとお任せ（ショート）
  'pack_manage_long':  false,  // 運用まるごとお任せ（長尺）（停止中）
  'post_short':        true,   // 投稿丸投げプラン（ショート動画）
  'post_long':         true    // 投稿丸投げプラン（YouTube長尺）
};

function getServiceStatus() {
  var props = PropertiesService.getScriptProperties();
  var json  = props.getProperty('service_status') || '{}';
  var status = JSON.parse(json);
  // デフォルト値をマージ（未設定キーは defaults で補完）
  Object.keys(SERVICE_DEFAULTS).forEach(function(k) {
    if (status[k] === undefined) status[k] = SERVICE_DEFAULTS[k];
  });
  return jsonResponse(status);
}

function updateServiceStatus(data) {
  var props  = PropertiesService.getScriptProperties();
  var json   = props.getProperty('service_status') || '{}';
  var status = JSON.parse(json);
  // action / key 以外のキーをすべて更新
  Object.keys(data).forEach(function(k) {
    if (k !== 'key' && k !== 'action') status[k] = data[k];
  });
  props.setProperty('service_status', JSON.stringify(status));
  return jsonResponse({ success: true, status: status });
}

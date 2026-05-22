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
var ADMIN_KEY         = 'monocreate2025';       // admin.htmlのADMIN_PASSWORDと揃える
var CHATWORK_TOKEN    = 'f79405b3d71215d721e6a9d3f86f55a6';
var CHATWORK_ROOM_ID  = '';                      // 通知先ルームID（新規作成後に入力）
var CHATWORK_MENTION  = 9377370;                 // 中村航汰のアカウントID
var SHEET_NAME        = 'inquiries';
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

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ── GET: 管理画面向けAPI ──────────────────────────────────────
function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();
  var key    = e.parameter.key || '';

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

  if (action === 'portfolio') {
    return listPortfolio();
  }

  if (action === 'portfolio_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deletePortfolio(row);
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
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
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
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('portfolio');
  if (!sheet) {
    sheet = ss.insertSheet('portfolio');
    sheet.appendRow(['追加日時', 'URL', 'タイトル', 'ジャンル', 'タイプ', '表示順']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return sheet;
}

function jsonResponse(obj) {
  var output = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

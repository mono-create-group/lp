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

// ─── 設定（フォールバック値。ScriptProperties で上書き可能）────────
var ADMIN_KEY         = '20180412k';
var SPREADSHEET_ID    = '13RESWCy5tuOqVzzG5aoeIFtyDk--OrLnpaPDep5yjj0';
var CHATWORK_TOKEN    = 'f79405b3d71215d721e6a9d3f86f55a6';
var CHATWORK_ROOM_ID  = '437407663';  // HPお問い合わせ
var PAYMENT_ROOM_ID   = '437439208';  // 振込確認依頼
var EDITOR_ROOM_ID    = '438093676';  // 🎬編集者募集（応募通知専用）
var CHATWORK_MENTION  = 9377370;
var SHEET_NAME        = 'inquiries';
var OWNER_EMAIL       = 'mono.create.group@gmail.com';  // オーナー通知先
var LP_BASE_URL       = 'https://mono-create-group.github.io/lp/';

// ─── LINE Messaging API ───────────────────────────────────────
var LINE_CHANNEL_SECRET       = '1322ddbd622dbea420f68cfc2bd957f5';
var LINE_CHANNEL_ACCESS_TOKEN = 'WoL98l0NE3ZWox6Kd5ntByqB85NlyxtoJ7Jwf/7f0T/TuCbmF9lHu5t90JR0kE7Jyz5sm5/B+pozKep+8s9Esv0Abhu/KbuAAOXRM7tMspiKlEfFme11mk6Fwowo4+pNeVUlUfR07h54CGZYLgxfdQdB04t89/1O/w1cDnyilFU=';
var LINE_REPLY_API            = 'https://api.line.me/v2/bot/message/reply';
var LINE_PUSH_API             = 'https://api.line.me/v2/bot/message/push';
var OWNER_LINE_UID            = ''; // オーナーのLINE UID（Script Properties: OWNER_LINE_UID）

// 素材アップロード用：親フォルダID（mono.create.group@gmail.comが所有）
var MATERIAL_PARENT_FOLDER_ID = '1YdwuPGNqYQZiHeseuMtyXF2GKkyqmSvo';

// ─── ScriptProperties で上書き（推奨）──────────────────────────────
// GAS エディタ → プロジェクトの設定 → スクリプトプロパティ で以下を設定：
//   ADMIN_KEY / SPREADSHEET_ID / CHATWORK_TOKEN / CHATWORK_ROOM_ID
//   PAYMENT_ROOM_ID / EDITOR_ROOM_ID / MATERIAL_PARENT_FOLDER_ID
// 設定するとソースコードからシークレットを完全分離できます。
(function applyScriptProps() {
  try {
    var p = PropertiesService.getScriptProperties();
    var overrides = {
      ADMIN_KEY: 'ADMIN_KEY', SPREADSHEET_ID: 'SPREADSHEET_ID',
      CHATWORK_TOKEN: 'CHATWORK_TOKEN', CHATWORK_ROOM_ID: 'CHATWORK_ROOM_ID',
      PAYMENT_ROOM_ID: 'PAYMENT_ROOM_ID', EDITOR_ROOM_ID: 'EDITOR_ROOM_ID',
      MATERIAL_PARENT_FOLDER_ID: 'MATERIAL_PARENT_FOLDER_ID'
    };
    if (p.getProperty('ADMIN_KEY'))              ADMIN_KEY              = p.getProperty('ADMIN_KEY');
    if (p.getProperty('SPREADSHEET_ID'))         SPREADSHEET_ID         = p.getProperty('SPREADSHEET_ID');
    if (p.getProperty('CHATWORK_TOKEN'))         CHATWORK_TOKEN         = p.getProperty('CHATWORK_TOKEN');
    if (p.getProperty('CHATWORK_ROOM_ID'))       CHATWORK_ROOM_ID       = p.getProperty('CHATWORK_ROOM_ID');
    if (p.getProperty('PAYMENT_ROOM_ID'))        PAYMENT_ROOM_ID        = p.getProperty('PAYMENT_ROOM_ID');
    if (p.getProperty('EDITOR_ROOM_ID'))         EDITOR_ROOM_ID         = p.getProperty('EDITOR_ROOM_ID');
    if (p.getProperty('MATERIAL_PARENT_FOLDER_ID')) MATERIAL_PARENT_FOLDER_ID = p.getProperty('MATERIAL_PARENT_FOLDER_ID');
    if (p.getProperty('LINE_CHANNEL_SECRET'))       LINE_CHANNEL_SECRET       = p.getProperty('LINE_CHANNEL_SECRET');
    if (p.getProperty('LINE_CHANNEL_ACCESS_TOKEN')) LINE_CHANNEL_ACCESS_TOKEN = p.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (p.getProperty('OWNER_LINE_UID'))            OWNER_LINE_UID            = p.getProperty('OWNER_LINE_UID');
  } catch(e) { Logger.log('ScriptProperties load error: ' + e); }
})();

// 契約書PDF保管用サブフォルダ名（クライアント向け契約書PDF用）
var CONTRACT_PDF_SUBFOLDER_NAME = '_契約書PDF';

// ── 業務委託契約書フォルダ ───────────────────────────────────────────
// ① 生成した契約書ドキュメントの保管フォルダ名（MATERIAL_PARENT_FOLDER_ID配下に自動作成）
//    ※ Shared Driveではなく My Drive配下に置くことでsetSharingが正常動作する
var CONTRACT_DOC_SUBFOLDER_NAME = '業務委託契約書';
var CONTRACT_DOC_FOLDER_URL = 'https://drive.google.com/drive/folders/' + MATERIAL_PARENT_FOLDER_ID;
// ② 署名済みPDF提出先フォルダ（編集者向け）
var CONTRACT_PDF_FOLDER_URL = 'https://drive.google.com/drive/folders/1cKPzB0xdMRTyCjYv_OIyNK-hm5ssiQPh';
// ③ 署名済みPDF提出先フォルダ（営業スタッフ向け）
var SALES_CONTRACT_PDF_FOLDER_URL = 'https://drive.google.com/drive/folders/1dhw0bqA-6n89Sy6oaDlLVH2XSb7oCDsi';

// 編集者向け業務委託契約書テンプレート（Google Docs ID）
var EDITOR_CONTRACT_TEMPLATE_ID = '108LpKal-QeMve2pcsvMUs6OkyUbxQyunHsHQUaYj428';
// 営業スタッフ向け業務委託契約書テンプレート（Google Drive docx）
var SALES_CONTRACT_TEMPLATE_ID = '1NpiCVl7kputu1NmTkyhU6yYkfezq-SqK';  // 雛形ファイルID
// 営業スタッフ用Chatworkグループ
var SALES_CHATWORK_INVITE = 'https://www.chatwork.com/g/750rzjj9wmz5gl';
// 営業スタッフ用マニュアルChatwork（グループ内に記載）
var SALES_MANUAL_CW = 'https://www.chatwork.com/g/750rzjj9wmz5gl';

// ─── 営業チーム Chatworkルーム ────────────────────────────────────
var SALES_ROOM_GENERAL    = '439255719';  // 営業スタッフ_全体連絡
var SALES_ROOM_REPORT     = '439256739';  // 【営業チーム】成約報告
var SALES_ROOM_KNOWLEDGE  = '439256742';  // 【営業チーム】ノウハウ・テンプレ共有
var SALES_ROOM_SUPPORT    = '439256745';  // 【営業チーム】質問・サポート

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
  'trial':           'hearing/short.html',
  'short-single':    'hearing/short.html',
  'edit-short':      'hearing/short.html',
  'long-single':     'hearing/long-single.html',
  'edit-long':       'hearing/set-long.html',
  'set-8':           'hearing/set-short.html',
  'set-10':          'hearing/set-short.html',
  'set-15':          'hearing/set-short.html',
  'set-30':          'hearing/set-short.html',
  'set-long':        'hearing/set-long.html',
  'mixed-std':       'hearing/ops-pack.html',
  'mixed-pre':       'hearing/ops-pack.html',
  'dispatch':        'hearing/dispatch.html',
  'portfolio-free':  'hearing/portfolio-free.html',
};
// ────────────────────────────────────────────────────────────────

// ================================================================
// メール自動返信ヘルパー
// ================================================================

// お客様への自動返信（メールアドレスがある場合のみ送信）
function sendAutoReply(toEmail, name, subject, bodyLines) {
  if (!toEmail || toEmail.indexOf('@') === -1) return;
  var greetingTxt = name ? name + ' 様\n\n' : '';
  var footerLines = [
    '',
    '─────────────────────────',
    'mono.create',
    'メール: ' + OWNER_EMAIL,
    'HP: ' + LP_BASE_URL,
    '',
    '💬 LINEでもご連絡いただけます（追加発注・修正依頼もLINEで完結）',
    '友だち追加: https://line.me/ti/p/@229dbicf',
    '─────────────────────────'
  ];
  var plainBody = greetingTxt + bodyLines.join('\n') + footerLines.join('\n');

  // HTML版：table-based layout (Outlook/Gmail/Apple Mail 全対応)
  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function lineToHtml(line) {
    return escHtml(line).replace(/(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" style="color:#2563EB;text-decoration:underline;word-break:break-all;">$1</a>');
  }
  var rows = [];
  // 宛名
  if (name) {
    rows.push('<tr><td style="padding:0 0 18px 0;font-family:Arial,\'Noto Sans JP\',sans-serif;font-size:15px;color:#1E293B;">'
      + escHtml(name) + ' 様</td></tr>');
  }
  // 本文
  bodyLines.forEach(function(l) {
    if (!l) {
      rows.push('<tr><td style="padding:4px 0;font-size:15px;">&nbsp;</td></tr>');
    } else {
      rows.push('<tr><td style="padding:2px 0 4px 0;font-family:Arial,\'Noto Sans JP\',sans-serif;font-size:15px;color:#1E293B;line-height:1.75;">'
        + lineToHtml(l) + '</td></tr>');
    }
  });
  // 区切り
  rows.push('<tr><td style="padding:18px 0 12px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="border-top:1px solid #E2E8F0;font-size:0px;line-height:0;">&nbsp;</td></tr></table></td></tr>');
  // フッター
  footerLines.forEach(function(l) {
    rows.push('<tr><td style="padding:1px 0;font-family:Arial,\'Noto Sans JP\',sans-serif;font-size:13px;color:#64748B;">'
      + escHtml(l) + '</td></tr>');
  });
  var htmlBody = '<!DOCTYPE html><html><head>'
    + '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '</head><body style="margin:0;padding:0;background-color:#F8FAFC;">'
    + '<!--[if mso]><table width="100%" cellpadding="0" cellspacing="0"><tr><td><![endif]-->'
    + '<table align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">'
    + '<tr><td style="padding:0;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="background:#1E40AF;padding:18px 28px;">'
    + '<span style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:1px;">mono.create</span>'
    + '</td></tr>'
    + '<tr><td style="background:#ffffff;padding:32px 28px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0">'
    + rows.join('')
    + '</table></td></tr>'
    + '<tr><td style="background:#F1F5F9;padding:14px 28px;text-align:center;">'
    + '<span style="font-family:Arial,sans-serif;font-size:12px;color:#94A3B8;">© mono.create | '
    + '<a href="' + LP_BASE_URL + '" style="color:#94A3B8;text-decoration:underline;">' + LP_BASE_URL + '</a></span>'
    + '</td></tr>'
    + '</table></td></tr></table>'
    + '<!--[if mso]></td></tr></table><![endif]-->'
    + '</body></html>';

  MailApp.sendEmail({
    to:       toEmail,
    subject:  subject,
    body:     plainBody,
    htmlBody: htmlBody,
    name:     'mono.create',
    replyTo:  OWNER_EMAIL
  });
}

// オーナーへ通知（LINE優先 → LINE未設定時のみメール）
function notifyOwnerEmail(subject, lines) {
  var body = lines.join('\n');
  if (OWNER_LINE_UID) {
    // LINE を主チャネルとして送信
    var text = subject + '\n\n' + lines.filter(function(l){ return !!l; }).join('\n');
    if (text.length > 2000) text = text.substring(0, 1997) + '…';
    pushToLine(OWNER_LINE_UID, [{ type: 'text', text: text }]);
  } else {
    // LINE UID 未設定時はメールをフォールバック
    MailApp.sendEmail({ to: OWNER_EMAIL, subject: subject, body: body, name: 'mono.create LP' });
  }
}

// クライアントへ通知（LINE優先 → LINE未設定時のみメール）
// lineUid がある場合は LINE push、ない場合は email（どちらかのみ送信）
function notifyClientLineOrEmail(lineUid, toEmail, name, lineText, emailSubject, emailBodyLines) {
  if (lineUid) {
    // LINE push（メールは送らない）
    var text = lineText;
    if (text.length > 2000) text = text.substring(0, 1997) + '…';
    pushToLine(lineUid, [{ type: 'text', text: text }]);
  } else if (toEmail && toEmail.indexOf('@') !== -1) {
    // LINE UID なし → メールフォールバック
    sendAutoReply(toEmail, name, emailSubject, emailBodyLines);
  }
}

// 文字列がメールアドレスか判定
function isEmail(str) {
  return !!(str && str.indexOf('@') !== -1 && str.indexOf('.') !== -1);
}
// ────────────────────────────────────────────────────────────────

// ── POST: フォーム受信 / ポートフォリオ追加・更新 ───────────────
function doPost(e) {
  try {
    var rawBody = (e.postData && e.postData.contents) ? e.postData.contents : '{}';

    // ── LINE Messaging API Webhook ──────────────────────────────
    // LINE からのリクエストは "events" 配列を含む
    if (rawBody.indexOf('"replyToken"') >= 0 || rawBody.indexOf('"destination"') >= 0) {
      try {
        var linePayload = JSON.parse(rawBody);
        if (linePayload.events && Array.isArray(linePayload.events)) {
          return handleLineWebhook(linePayload);
        }
      } catch(le) { Logger.log('LINE parse error: ' + le); }
    }

    var data = JSON.parse(rawBody);

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

    // 無料PF制作 申込
    if (data.action === 'pf_submit') {
      return submitPFInquiry(data);
    }

    // 無料PF制作 設定更新
    if (data.action === 'pf_config_update') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return updatePFConfig(data);
    }

    // 編集者 保存（追加・更新）管理者のみ
    if (data.action === 'editor_save') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return saveEditor(data);
    }

    // 編集者 公開応募フォーム（認証不要）
    if (data.action === 'editor_apply') {
      return applyEditor(data);
    }

    // 採用編集者 自己プロフィール登録（認証不要・採用メールリンク経由）
    if (data.action === 'editor_self_register') {
      return editorSelfRegister(data);
    }

    // 電子契約署名（認証不要・トークン認証）
    if (data.action === 'sign_contract') {
      return signContract(data.token || '', data.signed_name || '', data.user_agent || '');
    }

    // 営業スタッフ 公開応募フォーム（認証不要）
    if (data.action === 'sales_apply') {
      return applySales(data);
    }

    // パートナー登録フォーム（認証不要）
    if (data.action === 'partner_apply') {
      return applyPartner(data);
    }

    // 振込完了通知
    if (data.action === 'payment_notify') {
      return notifyPayment(data);
    }

    // 請求書送付（メール + シート保存 + Drive保存）
    if (data.action === 'send_invoice') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return sendInvoice(data);
    }

    // 請求書ステータス更新
    if (data.action === 'update_invoice_status') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return updateInvoiceStatus(data.inv_num || '', data.status || '未払い');
    }

    // クライアントマスタ 保存（追加・更新）
    if (data.action === 'client_master_save') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return saveClientMaster(data);
    }

    // プライベートリンク 生成
    if (data.action === 'private_link_create') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return createPrivateLink(data);
    }

    // 編集者契約書送付メール
    if (data.action === 'send_editor_contract') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return sendEditorContractMail(data);
    }

    // 契約同意記録（管理者のみ書き込み可）
    if (data.type === 'contract') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return saveContract(data);
    }

    // ヒアリングシート回答（クライアントからの公開フォーム送信 → 認証不要）
    if (data.type === 'hearing') {
      return saveHearing(data);
    }

    // 追加発注（LINE経由・フォーム経由・認証不要）
    if (data.action === 'additional_order') {
      return saveAdditionalOrder(data);
    }

    // LINE管理者プッシュ（管理者のみ・テンプレ送信）
    if (data.action === 'admin_line_push') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return adminLinePush(data);
    }

    // FBシート送信（クライアントからの公開フォーム送信 → 認証不要）
    if (data.action === 'save_feedback') {
      return saveFeedback(data);
    }

    // 売上記録（管理者のみ書き込み可）
    if (data.type === 'sales') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return saveSales(data);
    }

    // 経費記録（手動入力）
    if (data.type === 'expense') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      return saveExpense(data);
    }

    // スクリプトプロパティ設定（管理者のみ）
    if (data.action === 'set_script_property') {
      if (data.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      var propKey = data.prop_key || '';
      var propVal = data.prop_val || '';
      if (!propKey) return jsonResponse({ error: 'prop_key required' });
      PropertiesService.getScriptProperties().setProperty(propKey, propVal);
      // 即時適用
      if (propKey === 'OWNER_LINE_UID') OWNER_LINE_UID = propVal;
      return jsonResponse({ success: true, prop_key: propKey });
    }

    // 管理者パスワード（ADMIN_KEY）変更
    if (data.type === 'changePw') {
      if (!data.old_key || data.old_key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
      if (!data.new_key || String(data.new_key).length < 8) return jsonResponse({ error: 'invalid key' });
      PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', String(data.new_key));
      return jsonResponse({ success: true });
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
      data.name          || '',
      data.company       || '',
      data.email         || '',
      data.chatwork_id   || '',
      data.plan          || '',
      data.message       || '',
      '未対応',
      '',                          // trial (9列目)
      data.referral_code || ''     // 紹介コード (10列目)
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
        data.referral_code ? '紹介コード: ' + data.referral_code + '（割引が適用されます）' : '',
        '',
        '────────────────────────────',
        '💬 LINEでの連絡を推奨しています（ご登録お願いします）',
        '────────────────────────────',
        '今後の連絡・修正依頼・追加発注など全てLINEで完結できます。',
        '下記から友だち追加をしていただくとスムーズです👇',
        'https://line.me/ti/p/@229dbicf',
        '',
        '────────────────────────────',
        '📅 オンライン面談をご希望の方へ',
        '────────────────────────────',
        'ご希望の方は、下記リンクから日程をお選びください。',
        'https://timerex.net/s/sutchiokapi_1fa4/2bc09803',
        '',
        '※ 予約フォームには、このお問い合わせに記載のお名前をご入力ください。',
        '────────────────────────────',
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
        data.referral_code ? '🎁 紹介コード: ' + data.referral_code : '',
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

  // 無料PF制作設定（LP側からkeyなしで呼ばれるため認証不要）
  if (action === 'pf_config') {
    return getPFConfig();
  }

  // 編集者一覧（LP側からも呼ばれるため認証不要）
  if (action === 'editors') {
    return listEditors();
  }

  // Google DriveファイルのURL→名前取得（管理者キー必須）
  if (action === 'drive_file_info') {
    if (key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return getDriveFileInfo(e.parameter.url || '');
  }

  // LP コンテンツ取得（認証不要 — LPから直接呼ばれる）
  if (action === 'content_get') {
    return getLpContent();
  }

  // ── 認証不要：クライアントがトークンリンクでアクセスする ────────
  if (action === 'private_link_get') {
    return getPrivateLink(e.parameter.t || '');
  }
  if (action === 'private_link_view') {
    return recordPrivateLinkView(e.parameter.t || '');
  }

  // 電子契約書取得（トークン認証・公開）
  if (action === 'get_contract') {
    var t = e.parameter.t || '';
    if (!t) return jsonResponse({ error: 'token_required' });
    return getContractByToken(t);
  }

  // ── 以降は管理者キー必須 ──────────────────────────────────────
  if (key !== ADMIN_KEY) {
    return jsonResponse({ error: 'unauthorized' });
  }

  // LINE テンプレート一覧
  if (action === 'line_templates') {
    return jsonResponse({ templates: LINE_TEMPLATES });
  }

  // 署名完了メール再送テスト
  if (action === 'test_contract_email') {
    return testContractEmail(e.parameter.token || '');
  }

  // 請求書一覧
  if (action === 'list_invoices') {
    return listInvoices();
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

  if (action === 'pf_inquiries') {
    return listPFInquiries();
  }
  if (action === 'pf_status') {
    var row = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updatePFStatus(row, status);
  }
  if (action === 'pf_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deletePFInquiry(row);
  }

  if (action === 'editor_applications') {
    return listEditorApplications();
  }

  if (action === 'sales_applications') {
    return listSalesApplications();
  }

  if (action === 'sales_app_status') {
    var row    = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updateSalesAppStatus(row, status);
  }

  if (action === 'sales_app_delete') {
    var row = parseInt(e.parameter.row, 10);
    if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('sales_applications');
    if (sh) sh.deleteRow(row);
    return jsonResponse({ success: true });
  }

  if (action === 'partner_applications') {
    return listPartnerApplications();
  }

  if (action === 'partner_app_status') {
    var row = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updatePartnerAppStatus(row, status);
  }

  if (action === 'partner_app_delete') {
    var row = parseInt(e.parameter.row, 10);
    if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('partner_applications');
    if (sh) sh.deleteRow(row);
    return jsonResponse({ success: true });
  }

  if (action === 'partner_reward_send') {
    var row = parseInt(e.parameter.row, 10);
    var amount = e.parameter.amount || '';
    return sendPartnerReward(row, amount);
  }

  // 報酬一覧（自動計算版）
  if (action === 'partner_rewards') {
    return listPartnerRewards();
  }

  // 報酬確定メール自動送信
  if (action === 'partner_reward_email_auto') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    var row = parseInt(e.parameter.row, 10);
    return sendPartnerRewardEmailAuto(row);
  }

  // 報酬 支払済みマーク
  if (action === 'partner_reward_paid') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    var row = parseInt(e.parameter.row, 10);
    return markRewardPaid(row);
  }

  if (action === 'editor_app_status') {
    var row = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('editor_applications');
    if (!sh) return jsonResponse({ success: true });
    var prevStatus = sh.getRange(row, 13).getValue();  // 変更前のステータスを取得
    sh.getRange(row, 13).setValue(status);  // 13列目=ステータス

    // ── 採用決定 → Chatwork招待メールを自動送信（初回のみ・重複防止）──
    if (status === '採用決定' && prevStatus !== '採用決定') {
      var rowData = sh.getRange(row, 1, 1, 13).getValues()[0];
      var editorName  = rowData[1] || '';
      var editorEmail = rowData[4] || '';
      var caseType    = rowData[5] || '';
      var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

      // ── 個別契約書署名URL発行（電子契約システム）──
      var editorContractUrl = issueContractUrl('editor', editorName, editorEmail);

      // 応募者へ合格通知メール（Chatwork招待リンク付き）
      if (editorEmail && editorEmail.indexOf('@') !== -1) {
        var subject = '【mono.create】編集者採用のご連絡 — 面談のご予約・Chatworkグループへご参加ください';
        var body = [
          editorName + ' 様',
          '',
          'この度はmono.createへのご応募ありがとうございます。',
          '選考の結果、ぜひ一緒にお仕事をさせていただきたいと思います。',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ① Chatworkグループへの参加',
          '━━━━━━━━━━━━━━━━━━━━',
          '下記のリンクからmono.create編集者グループにご参加ください。',
          '',
          '🔗 Chatworkグループ招待リンク',
          'https://www.chatwork.com/g/ig45bwg3tqzkxg',
          '',
          '※ Chatworkのアカウントをお持ちでない場合は、',
          '  上記リンクから無料登録後にグループへご参加ください。',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ② オンライン面談のご予約（必須）',
          '━━━━━━━━━━━━━━━━━━━━',
          '業務開始前に担当者（中村）とGoogle Meetにてオンライン面談を行います。',
          '下記のURLから、ご都合のよい日時をお選びください。',
          '',
          '📅 面談予約リンク（TimeRex）',
          'https://timerex.net/s/mono.create.group_1f8e/22c29f19',
          '',
          '面談後、問題がなければそのまま業務開始となります。',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ③ 業務委託契約書のご確認・ご署名（必須）',
          '━━━━━━━━━━━━━━━━━━━━',
          '案件開始前に業務委託契約書への電子署名をお願いしております。',
          '下記の専用リンクから内容をご確認のうえ、',
          'ページ下部の署名フォームより電子署名してください。',
          '',
          '✍️ 業務委託契約書（' + editorName + ' 様 専用・電子署名）',
          editorContractUrl,
          '',
          '📂 署名済みPDF提出先フォルダ',
          CONTRACT_PDF_FOLDER_URL,
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ④ プロフィール登録（LP掲載・必須）',
          '━━━━━━━━━━━━━━━━━━━━',
          'LP（サービスページ）の「編集者紹介」欄に掲載するため、',
          '下記フォームにプロフィール情報をご入力ください。',
          '（スキル・対応ジャンル・ポートフォリオURLなど）',
          '',
          '📝 プロフィール登録フォーム',
          LP_BASE_URL + 'editor-self-register.html?email=' + encodeURIComponent(editorEmail) + '&name=' + encodeURIComponent(editorName),
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '不明点があればこのメールへ返信ください。',
          'よろしくお願いいたします。',
          '',
          '担当：mono.create 運営 中村航汰',
        ].join('\n');

        MailApp.sendEmail({
          to:      editorEmail,
          subject: subject,
          body:    body,
          name:    'mono.create',
          replyTo: OWNER_EMAIL
        });
      }

      // 管理者にも通知
      var editorRoomId = EDITOR_ROOM_ID || CHATWORK_ROOM_ID;
      if (editorRoomId) {
        var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
          '━━━━━━━━━━━━━━━━━━━━\n' +
          '✅ 編集者採用決定 — 招待メール自動送信済み\n' +
          '━━━━━━━━━━━━━━━━━━━━\n' +
          '日時    : ' + now + '\n' +
          '名前    : ' + editorName + '\n' +
          'メール  : ' + editorEmail + '\n' +
          '希望案件: ' + caseType + '\n' +
          '━━━━━━━━━━━━━━━━━━━━\n' +
          '▶ Chatworkグループ参加待ち\n' +
          '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
        try {
          UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + editorRoomId + '/messages', {
            method: 'POST',
            headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
            payload: 'body=' + encodeURIComponent(msg)
          });
        } catch(e) {}
      }
    }

    // ── 見送り → 不採用通知メールを自動送信（初回のみ・重複防止）──
    if (status === '見送り' && prevStatus !== '見送り') {
      var rowDataR = sh.getRange(row, 1, 1, 13).getValues()[0];
      var editorNameR  = rowDataR[1] || '';
      var editorEmailR = rowDataR[4] || '';

      if (editorEmailR && editorEmailR.indexOf('@') !== -1) {
        sendAutoReply(editorEmailR, editorNameR,
          '【mono.create】編集者ご応募の選考結果について',
          [
            'この度はmono.createへのご応募いただきまして、',
            '誠にありがとうございます。',
            '',
            '慎重に選考を行いました結果、',
            '誠に残念ながら今回は採用を見送らせていただく',
            'こととなりました。',
            '',
            'ご応募いただいたご期待に添えず大変恐縮ですが、',
            '何卒ご了承くださいますようお願い申し上げます。',
            '',
            '今後の益々のご活躍をお祈り申し上げます。',
            '',
            '──────────────────────────',
            '※ 選考結果に関するご質問へのご回答は',
            '  いたしかねますのでご了承ください。',
            '──────────────────────────',
          ]
        );
      }
    }

    return jsonResponse({ success: true });
  }

  if (action === 'editor_app_delete') {
    var row = parseInt(e.parameter.row, 10);
    if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('editor_applications');
    if (sh) sh.deleteRow(row);
    return jsonResponse({ success: true });
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

  if (action === 'editor_delete') {
    var row = parseInt(e.parameter.row, 10);
    return deleteEditor(row);
  }

  // テンプレートファイル情報確認
  if (action === 'debug_template_info') {
    try {
      var tmpl = DriveApp.getFileById(SALES_CONTRACT_TEMPLATE_ID);
      var blob = tmpl.getBlob();
      return jsonResponse({ id: SALES_CONTRACT_TEMPLATE_ID, name: tmpl.getName(), mimeType: tmpl.getMimeType(), blobMime: blob.getContentType(), size: blob.getBytes().length });
    } catch(te) { return jsonResponse({ error: te.toString() }); }
  }

  // 個別契約書作成デバッグ（copyAsGoogleDoc方式）
  if (action === 'debug_contract') {
    var testName = e.parameter.name || 'テスト太郎';
    var step = 'init';
    try {
      step = 'getFolder';
      var folder2   = getOrCreateContractDocFolder();
      var folderName = folder2.getName();
      step = 'copyAsGoogleDoc';
      var dateStr2  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
      var docTitle2 = '【テスト契約書】' + testName + '_' + dateStr2;
      var newFile2  = copyAsGoogleDoc(SALES_CONTRACT_TEMPLATE_ID, docTitle2, folder2.getId());
      var docUrl = 'https://drive.google.com/uc?export=download&id=' + newFile2.getId();
      return jsonResponse({ success: true, file_id: newFile2.getId(), url: docUrl, folderName: folderName });
    } catch(dbgErr) {
      return jsonResponse({ success: false, step: step, error: dbgErr.toString(), stack: dbgErr.stack || '' });
    }
  }

  // 営業スタッフ採用メール テスト送信（指定メールへ送る）
  if (action === 'test_sales_adoption_email') {
    var toEmail = e.parameter.to || OWNER_EMAIL;
    var toName  = e.parameter.name || '中村航汰（テスト）';
    var contractUrl = issueContractUrl('sales', toName, toEmail);
    sendAutoReply(toEmail, toName,
      '【mono.create】営業スタッフ採用のご連絡',
      [
        'この度はmono.createへのご応募ありがとうございます。',
        '選考の結果、ぜひ一緒にお仕事をさせていただきたいと思います。',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ ① 業務委託契約書のご確認・ご署名（必須）',
        '━━━━━━━━━━━━━━━━━━━━',
        '案件開始前に業務委託契約書への電子署名をお願いしております。',
        '下記の専用リンクから内容をご確認のうえ、',
        'ページ下部の署名フォームより電子署名してください。',
        '',
        '✍️ 業務委託契約書（' + toName + ' 様 専用・電子署名）',
        contractUrl,
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ ② Chatworkグループへの参加',
        '━━━━━━━━━━━━━━━━━━━━',
        '下記のリンクからmono.create営業スタッフグループにご参加ください。',
        'グループ内にマニュアルも記載されていますので、必ずご確認ください。',
        '',
        '🔗 Chatworkグループ招待リンク（＆マニュアル）',
        SALES_CHATWORK_INVITE,
        '',
        '※ Chatworkのアカウントをお持ちでない場合は、',
        '  上記リンクから無料登録後にグループへご参加ください。',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ ③ 中村のDMへの追加',
        '━━━━━━━━━━━━━━━━━━━━',
        'Chatworkで下記IDを検索し、ダイレクトメッセージから',
        '「営業スタッフとして採用いただきました〇〇です」とご連絡ください。',
        '',
        '💬 Chatwork ID：wl0b2t4akjur（mono.create 中村航汰）',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '不明点があればこのメールへ返信ください。',
        'よろしくお願いいたします。',
        '',
        '担当：mono.create 運営 中村航汰',
      ]
    );
    return jsonResponse({ success: true, to: toEmail, contract_url: contractUrl });
  }

  if (action === 'test_editor_adoption_email') {
    var toEmail = e.parameter.to || OWNER_EMAIL;
    var toName  = e.parameter.name || '中村航汰（テスト）';
    var contractUrl = issueContractUrl('editor', toName, toEmail);
    sendAutoReply(toEmail, toName,
      '【mono.create】動画編集者採用のご連絡',
      [
        'この度はmono.createへのご応募ありがとうございます。',
        '選考の結果、ぜひ一緒にお仕事をさせていただきたいと思います。',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ ① 業務委託契約書のご確認・ご署名（必須）',
        '━━━━━━━━━━━━━━━━━━━━',
        '案件開始前に業務委託契約書への電子署名をお願いしております。',
        '下記の専用リンクから内容をご確認のうえ、',
        'ページ下部の署名フォームより電子署名してください。',
        '',
        '✍️ 業務委託契約書（' + toName + ' 様 専用・電子署名）',
        contractUrl,
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '不明点があればこのメールへ返信ください。',
        'よろしくお願いいたします。',
        '',
        '担当：mono.create 運営 中村航汰',
      ]
    );
    return jsonResponse({ success: true, to: toEmail, contract_url: contractUrl });
  }


  // Drive ファイルの共有設定（GAS経由）
  if (action === 'share_drive_file') {
    var fileId = e.parameter.file_id;
    if (!fileId) return jsonResponse({ success: false, error: 'file_id required' });
    try {
      var file = DriveApp.getFileById(fileId);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var url = 'https://docs.google.com/document/d/' + fileId + '/edit?usp=sharing';
      return jsonResponse({ success: true, url: url, name: file.getName() });
    } catch(e2) {
      return jsonResponse({ success: false, error: e2.toString() });
    }
  }

  if (action === 'create_trial_folder') {
    var clientName = e.parameter.name || 'unknown';
    return jsonResponse(createClientMaterialFolder(clientName));
  }

  // ── 一括削除 ──
  if (action === 'clear_inquiries')  return clearSheet(SHEET_NAME);
  if (action === 'clear_payments')   return clearSheet('payments');
  if (action === 'clear_sales')      return clearSheet('uriage');
  if (action === 'clear_expenses')   return clearSheet('keiei');

  if (action === 'expenses') {
    return listExpenses();
  }
  if (action === 'expense_delete') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    var row = parseInt(e.parameter.row, 10);
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('keiei');
    if (sh && row > 1) sh.deleteRow(row);
    return jsonResponse({ success: true });
  }
  if (action === 'monthly_summary') {
    return getMonthlySummary(e.parameter.month || '');
  }
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

  // お詫び＋ヒアリングシート再送
  if (action === 'send_apology_hearing') {
    if (key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return sendApologyHearing(
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

  // LP コンテンツ更新（admin認証必須）
  if (action === 'content_update') {
    return jsonResponse({ error: 'use POST' });
  }

  // ── クライアントマスタ ──────────────────────────────────────
  if (action === 'client_master_list') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return listClientMaster();
  }
  if (action === 'client_master_delete') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return deleteClientMaster(parseInt(e.parameter.row));
  }

  // ── プライベートリンク ──────────────────────────────────────
  if (action === 'private_link_get') {
    return getPrivateLink(e.parameter.t || '');
  }
  if (action === 'private_link_list') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return listPrivateLinks();
  }
  if (action === 'private_link_delete') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    return deletePrivateLink(e.parameter.t || '');
  }
  if (action === 'private_link_view') {
    // 閲覧カウントインクリメント（認証不要）
    return recordPrivateLinkView(e.parameter.t || '');
  }

  // ── Driveファイル削除（テストデータ掃除用） ──────────────────
  if (action === 'delete_drive_file') {
    if (e.parameter.key !== ADMIN_KEY) return jsonResponse({ error: 'unauthorized' });
    var fileId = e.parameter.file_id || '';
    if (!fileId) return jsonResponse({ error: 'file_id required' });
    try {
      var file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
      return jsonResponse({ success: true, title: file.getName() });
    } catch(err) {
      return jsonResponse({ error: err.message });
    }
  }

  // ── 追加発注一覧 ──────────────────────────────────────────────
  if (action === 'additional_orders') {
    return listAdditionalOrders();
  }
  if (action === 'additional_order_status') {
    var row = parseInt(e.parameter.row, 10);
    var status = e.parameter.status || '';
    return updateAdditionalOrderStatus(row, status);
  }
  if (action === 'additional_order_delete') {
    var row = parseInt(e.parameter.row, 10);
    if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName('additional_orders');
    if (sh) sh.deleteRow(row);
    return jsonResponse({ success: true });
  }

  // ── FBフィードバック一覧 ──────────────────────────────────────
  if (action === 'feedbacks') {
    return listFeedbacks();
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
      status:        row[7] || '未対応',
      trial:         row[8] || '',    // 'トライアル' or '' (9列目)
      referral_code: row[9] || ''     // 紹介コード (10列目)
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
    data.referral_code ? '🎁 紹介コード：' + data.referral_code + '（割引適用対象）' : '',
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
  SpreadsheetApp.flush(); // 書き込みを即時コミット
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
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreatePortfolioSheet();
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ================================================================
// 編集者管理
// editors シート列構成:
//  1:登録日時 2:名前 3:アイコンURL 4:職業 5:編集歴
//  6:ジャンル 7:得意スタイル 8:対応ソフト
//  9:月の対応本数 10:週の対応本数 11:1日稼働時間 12:週稼働時間
//  13:稼働時間帯 14:コメント 15:ポートフォリオJSON 16:表示順
// ================================================================
function getOrCreateEditorsSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('editors');
  if (!sheet) {
    sheet = ss.insertSheet('editors');
    sheet.appendRow(['登録日時','名前','アイコンURL','職業','編集歴',
      'ジャンル','得意スタイル','対応ソフト',
      '月の対応本数','週の対応本数','1日稼働時間','週稼働時間',
      '稼働時間帯','コメント','ポートフォリオJSON','表示順']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,16).setFontWeight('bold');
  }
  return sheet;
}

function listEditors() {
  var sheet  = getOrCreateEditorsSheet();
  var values = sheet.getDataRange().getValues();
  var data   = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[1]) continue; // 名前空はスキップ
    var portfolios = [];
    try { portfolios = JSON.parse(r[14]); } catch(e) {}
    data.push({
      row:              i + 1,
      date:             r[0]  || '',
      name:             r[1]  || '',
      icon:             r[2]  || '',
      occupation:       r[3]  || '',
      experience:       r[4]  || '',
      genres:           r[5]  || '',
      style:            r[6]  || '',
      software:         r[7]  || '',
      monthly_capacity: r[8]  || '',
      weekly_capacity:  r[9]  || '',
      daily_hours:      r[10] || '',
      weekly_hours:     r[11] || '',
      work_hours:       r[12] || '',
      comment:          r[13] || '',
      portfolios:       portfolios,
      order:            r[15] || 99
    });
  }
  data.sort(function(a,b){ return (a.order - b.order) || (a.date < b.date ? 1 : -1); });
  return jsonResponse({ data: data });
}

// ── 採用編集者 自己プロフィール登録（採用メールリンク経由） ──────────────
function editorSelfRegister(data) {
  var sheet = getOrCreateEditorsSheet();
  var now   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  var portfoliosJson = JSON.stringify(Array.isArray(data.portfolios) ? data.portfolios : []);

  // 既存行のチェック（同名 or 同メールがあれば上書き）
  var values = sheet.getDataRange().getValues();
  var targetRow = -1;
  for (var i = 1; i < values.length; i++) {
    if (data.name && values[i][1] === data.name) { targetRow = i + 1; break; }
  }

  var vals = [
    now,
    data.name             || '',
    data.icon             || '',
    data.occupation       || '',
    data.experience       || '',
    data.genres           || '',
    data.style            || '',
    data.software         || '',
    data.monthly_capacity || '',
    '',  // weekly_capacity（派遣登録なし）
    '',  // daily_hours
    '',  // weekly_hours
    data.work_hours       || '',
    data.comment          || '',
    portfoliosJson,
    99   // 表示順（管理者が後で整える）
  ];

  if (targetRow > 1) {
    sheet.getRange(targetRow, 1, 1, 16).setValues([vals]);
  } else {
    sheet.appendRow(vals);
  }

  // オーナーへ通知
  notifyOwnerEmail(
    '【編集者プロフィール登録】' + (data.name || '名前なし'),
    [
      '登録日時 : ' + now,
      '名前     : ' + (data.name || ''),
      '職業     : ' + (data.occupation || ''),
      '編集歴   : ' + (data.experience || ''),
      'ジャンル : ' + (data.genres || ''),
      'ソフト   : ' + (data.software || ''),
      '月対応   : ' + (data.monthly_capacity || ''),
      '稼働時間 : ' + (data.work_hours || ''),
      'コメント : ' + (data.comment || ''),
      '',
      '▶ 管理画面（編集者タブ）: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

function saveEditor(data) {
  var sheet = getOrCreateEditorsSheet();
  var now   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  var portfoliosJson = JSON.stringify(Array.isArray(data.portfolios) ? data.portfolios : []);
  var row   = parseInt(data.row, 10);
  var vals  = [
    now,
    data.name             || '',
    data.icon             || '',
    data.occupation       || '',
    data.experience       || '',
    data.genres           || '',
    data.style            || '',
    data.software         || '',
    data.monthly_capacity || '',
    data.weekly_capacity  || '',
    data.daily_hours      || '',
    data.weekly_hours     || '',
    data.work_hours       || '',
    data.comment          || '',
    portfoliosJson,
    data.order            || 99
  ];
  if (row && row > 1) {
    sheet.getRange(row, 1, 1, 16).setValues([vals]);
  } else {
    sheet.appendRow(vals);
  }
  return jsonResponse({ success: true });
}

function deleteEditor(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreateEditorsSheet();
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteContract(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('contracts');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteHearing(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ── パートナー登録 ──────────────────────────────────────────────
// partner_applications シート:
// 受信日時|名前|メール|種別|URL|フォロワー/PV|紹介方法|発行コード|X|メッセージ|ステータス
function applyPartner(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('partner_applications');
  if (!sheet) {
    sheet = ss.insertSheet('partner_applications');
    sheet.appendRow([
      '受信日時','名前','メール','種別','URL',
      'フォロワー・PV','紹介方法','発行コード','X','メッセージ','ステータス'
    ]);
    sheet.setFrozenRows(1);
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // 紹介コード自動生成（英大文字＋数字 8文字ランダム）
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(I,O,0,1)を除外
  var autoCode = '';
  for (var i = 0; i < 8; i++) {
    autoCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  sheet.appendRow([
    now,
    data.name         || '',
    data.email        || '',
    data.partner_type || '',
    data.url          || '',
    data.audience     || '',
    data.method       || '',
    autoCode,
    data.twitter      || '',
    data.message      || '',
    '未対応'
  ]);

  // Chatwork通知（HPお問い合わせルームへ / メンション付き）
  if (CHATWORK_ROOM_ID) {
    var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '🤝 新規 パートナー登録申請 — mono.create\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '受信日時      : ' + now + '\n' +
      '名前          : ' + (data.name || '') + '\n' +
      'メール        : ' + (data.email || '') + '\n' +
      '種別          : ' + (data.partner_type || '') + '\n' +
      'URL           : ' + (data.url || '') + '\n' +
      'フォロワー・PV: ' + (data.audience || '') + '\n' +
      '紹介方法      : ' + (data.method || '') + '\n' +
      '発行コード    : ' + autoCode + '\n' +
      'X             : ' + (data.twitter || 'なし') + '\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      (data.message ? '【メッセージ】\n' + data.message + '\n━━━━━━━━━━━━━━━━━━━━\n' : '') +
      '▶ 管理画面で承認: ' + LP_BASE_URL + 'admin.html';
    try {
      UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages', {
        method: 'POST',
        headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
        payload: 'body=' + encodeURIComponent(msg)
      });
    } catch(e) {}
  }

  // 申請者への自動返信
  if (data.email && data.email.indexOf('@') !== -1) {
    sendAutoReply(data.email, data.name,
      '【mono.create】パートナー登録のご申請を受け付けました',
      [
        'この度はmono.createパートナープログラムへのご申請ありがとうございます。',
        '内容を確認のうえ、2〜3営業日以内に審査結果と専用コードをご連絡いたします。',
        '',
        '▼ ご申請内容',
        '種別: ' + (data.partner_type || ''),
        'URL: ' + (data.url || ''),
        '',
        '▼ 成約報酬（固定）',
        'ショート動画編集（単品）  : ¥500/件',
        '長尺動画・編集セット      : ¥1,500/件',
        '月額パック・運用代行      : ¥3,000/件',
        '継続ボーナス（月額パック3ヶ月〜）: +¥1,000/件',
        '',
        'ご不明な点がございましたら、このメールに返信してください。',
      ]
    );
  }

  // ── オーナーへのGmailバックアップ通知 ──
  notifyOwnerEmail(
    '【パートナー申請】' + (data.name || '名前なし') + ' — ' + (data.partner_type || ''),
    [
      '受信日時      : ' + now,
      '名前          : ' + (data.name || ''),
      'メール        : ' + (data.email || '未入力'),
      '種別          : ' + (data.partner_type || ''),
      'URL           : ' + (data.url || ''),
      'フォロワー・PV: ' + (data.audience || ''),
      '紹介方法      : ' + (data.method || ''),
      '発行コード    : ' + autoCode,
      'X             : ' + (data.twitter || 'なし'),
      '',
      data.message ? '【メッセージ】\n' + data.message : '',
      '',
      '▶ 管理画面で承認: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

// ── 編集者 公開応募 ────────────────────────────────────────────
// editor_applications シート:
// 受信日時|名前|年齢|性別|メール|希望案件|ポートフォリオURL|週・月の対応本数|得意分野|長期契約|派遣希望|メッセージ|ステータス
function applyEditor(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('editor_applications');
  if (!sheet) {
    sheet = ss.insertSheet('editor_applications');
    sheet.appendRow([
      '受信日時','名前','年齢','性別','メール',
      '希望案件','ポートフォリオURL','週・月の対応本数','得意分野',
      '長期契約','派遣希望','メッセージ','ステータス'
    ]);
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.name               || '',
    data.age                || '',
    data.gender             || '',
    data.email              || '',
    data.case_type          || '',
    data.portfolio          || '',
    data.weekly_monthly_vol || '',
    data.specialty          || '',
    data.long_term          || '',
    data.dispatch           || '',
    data.message            || '',
    '未対応'
  ]);

  // Chatwork通知（編集者募集専用ルームへ / メンション付きで通知音＆バッジ表示）
  var editorRoomId = EDITOR_ROOM_ID || CHATWORK_ROOM_ID;
  if (editorRoomId) {
    var dispatchLine = (data.dispatch && data.dispatch !== 'なし') ? '✅ 派遣登録希望あり\n' : '';
    var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '🎬 新規 編集者応募 — mono.create\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '受信日時: ' + now + '\n' +
      '名前    : ' + (data.name || '') + '（' + (data.age || '') + ' / ' + (data.gender || '') + '）\n' +
      'メール  : ' + (data.email || '') + '\n' +
      '希望案件: ' + (data.case_type || '') + '\n' +
      '対応本数: ' + (data.weekly_monthly_vol || '') + '\n' +
      '得意分野: ' + (data.specialty || '') + '\n' +
      '長期契約: ' + (data.long_term || '') + '\n' +
      dispatchLine +
      'PF URL  : ' + (data.portfolio || 'なし') + '\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      (data.message ? '【メッセージ】\n' + data.message + '\n━━━━━━━━━━━━━━━━━━━━\n' : '') +
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
    try {
      UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + editorRoomId + '/messages', {
        method: 'POST',
        headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
        payload: 'body=' + encodeURIComponent(msg)
      });
    } catch(e) {}
  }

  // 応募者への自動返信
  if (data.email && data.email.indexOf('@') !== -1) {
    sendAutoReply(data.email, data.name,
      '【mono.create】編集者ご応募を受け付けました',
      [
        'この度はmono.createへのご応募ありがとうございます。',
        '内容を確認のうえ、2〜3営業日以内にご連絡いたします。',
        '',
        '▼ ご応募内容',
        '希望案件: ' + (data.case_type || ''),
        '週・月の対応本数: ' + (data.weekly_monthly_vol || ''),
        '得意分野: ' + (data.specialty || ''),
        '長期契約: ' + (data.long_term || ''),
        '派遣希望: ' + (data.dispatch || 'なし'),
        '',
        '案件の状況によってはご連絡までお時間をいただく場合がございます。',
        'いましばらくお待ちください。',
      ]
    );
  }

  // ── オーナーへのGmailバックアップ通知 ──
  notifyOwnerEmail(
    '【編集者応募】' + (data.name || '名前なし') + ' — ' + (data.case_type || ''),
    [
      '受信日時  : ' + now,
      '名前/年齢 : ' + (data.name || '') + '（' + (data.age || '') + ' / ' + (data.gender || '') + '）',
      'メール    : ' + (data.email || '未入力'),
      '希望案件  : ' + (data.case_type || ''),
      '対応本数  : ' + (data.weekly_monthly_vol || ''),
      '得意分野  : ' + (data.specialty || ''),
      'PF URL   : ' + (data.portfolio || 'なし'),
      '長期契約  : ' + (data.long_term || ''),
      '派遣希望  : ' + (data.dispatch || 'なし'),
      '',
      data.message ? '【メッセージ】\n' + data.message : '',
      '',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

// editor_applications 一覧取得（管理者用）
function listEditorApplications() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('editor_applications');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:                i + 1,
      date:               r[0]  || '',
      name:               r[1]  || '',
      age:                r[2]  || '',
      gender:             r[3]  || '',
      email:              r[4]  || '',
      case_type:          r[5]  || '',
      portfolio:          r[6]  || '',
      weekly_monthly_vol: r[7]  || '',
      specialty:          r[8]  || '',
      long_term:          r[9]  || '',
      dispatch:           r[10] || '',
      message:            r[11] || '',
      status:             r[12] || '未対応'
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// ================================================================
// 営業スタッフ管理
// sales_applications シート列構成:
// 1:受信日時 2:名前 3:年齢 4:性別 5:メール
// 6:職業 7:営業経験 8:週稼働時間 9:SNS URL 10:知識レベル
// 11:長期契約 12:メッセージ 13:ステータス
// ================================================================

// 営業スタッフ 公開応募
function applySales(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('sales_applications');
  if (!sheet) {
    sheet = ss.insertSheet('sales_applications');
    sheet.appendRow([
      '受信日時','名前','年齢','性別','メール',
      '職業','営業経験','週稼働時間','SNS URL','知識レベル',
      '長期契約','メッセージ','ステータス'
    ]);
    sheet.setFrozenRows(1);
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.name        || '',
    data.age         || '',
    data.gender      || '',
    data.email       || '',
    data.occupation  || '',
    data.sales_exp   || '',
    data.weekly_hours|| '',
    data.sns_url     || '',
    data.knowledge   || '',
    data.long_term   || '',
    data.message     || '',
    '未対応'
  ]);

  // Chatwork通知
  var roomId = EDITOR_ROOM_ID || CHATWORK_ROOM_ID;
  if (roomId) {
    var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '💼 新規 営業スタッフ応募 — mono.create\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '受信日時  : ' + now + '\n' +
      '名前      : ' + (data.name || '') + '（' + (data.age || '') + ' / ' + (data.gender || '') + '）\n' +
      'メール    : ' + (data.email || '') + '\n' +
      '職業      : ' + (data.occupation || '') + '\n' +
      '営業経験  : ' + (data.sales_exp || '') + '\n' +
      '週稼働    : ' + (data.weekly_hours || '') + '\n' +
      '知識レベル: ' + (data.knowledge || '') + '\n' +
      '長期契約  : ' + (data.long_term || '') + '\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      (data.message ? '【志望動機・PR】\n' + data.message + '\n━━━━━━━━━━━━━━━━━━━━\n' : '') +
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
    try {
      UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + roomId + '/messages', {
        method: 'POST',
        headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
        payload: 'body=' + encodeURIComponent(msg)
      });
    } catch(e) {}
  }

  // 応募者への自動返信
  if (data.email && data.email.indexOf('@') !== -1) {
    sendAutoReply(data.email, data.name,
      '【mono.create】営業スタッフご応募を受け付けました',
      [
        'この度はmono.createへのご応募ありがとうございます。',
        '内容を確認のうえ、2〜3営業日以内にご連絡いたします。',
        '',
        '▼ ご応募内容',
        '職業      : ' + (data.occupation  || ''),
        '営業経験  : ' + (data.sales_exp   || ''),
        '週稼働時間: ' + (data.weekly_hours || ''),
        '長期契約  : ' + (data.long_term   || ''),
        '',
        '案件の状況によってはご連絡までお時間をいただく場合がございます。',
        'いましばらくお待ちください。',
      ]
    );
  }

  notifyOwnerEmail(
    '【営業スタッフ応募】' + (data.name || '名前なし'),
    [
      '受信日時  : ' + now,
      '名前/年齢 : ' + (data.name || '') + '（' + (data.age || '') + ' / ' + (data.gender || '') + '）',
      'メール    : ' + (data.email || '未入力'),
      '職業      : ' + (data.occupation || ''),
      '営業経験  : ' + (data.sales_exp || ''),
      '週稼働    : ' + (data.weekly_hours || ''),
      'SNS URL   : ' + (data.sns_url || 'なし'),
      '知識レベル: ' + (data.knowledge || ''),
      '長期契約  : ' + (data.long_term || ''),
      '',
      data.message ? '【志望動機・PR】\n' + data.message : '',
      '',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

// 営業スタッフ 一覧取得（管理者用）
function listSalesApplications() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('sales_applications');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:          i + 1,
      date:         r[0]  || '',
      name:         r[1]  || '',
      age:          r[2]  || '',
      gender:       r[3]  || '',
      email:        r[4]  || '',
      occupation:   r[5]  || '',
      sales_exp:    r[6]  || '',
      weekly_hours: r[7]  || '',
      sns_url:      r[8]  || '',
      knowledge:    r[9]  || '',
      long_term:    r[10] || '',
      message:      r[11] || '',
      status:       r[12] || '未対応'
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// 営業スタッフ ステータス更新
function updateSalesAppStatus(row, status) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('sales_applications');
  if (!sh) return jsonResponse({ success: true });
  var prevStatus = sh.getRange(row, 13).getValue();
  sh.getRange(row, 13).setValue(status);

  // ── 採用決定 → 個別契約書作成 + 採用通知メールを自動送信（初回のみ）──
  if (status === '採用決定' && prevStatus !== '採用決定') {
    var rowData    = sh.getRange(row, 1, 1, 13).getValues()[0];
    var salesName  = rowData[1] || '';
    var salesEmail = rowData[4] || '';
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    // ── 個別契約書署名URL発行（電子契約システム）──
    var individualContractUrl = issueContractUrl('sales', salesName, salesEmail);

    if (salesEmail && salesEmail.indexOf('@') !== -1) {
      sendAutoReply(salesEmail, salesName,
        '【mono.create】営業スタッフ採用のご連絡',
        [
          'この度はmono.createへのご応募ありがとうございます。',
          '選考の結果、ぜひ一緒にお仕事をさせていただきたいと思います。',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ① 業務委託契約書のご確認・ご署名（必須）',
          '━━━━━━━━━━━━━━━━━━━━',
          '案件開始前に業務委託契約書への電子署名をお願いしております。',
          '下記の専用リンクから契約書の内容をご確認のうえ、',
          'ページ下部の署名フォームより電子署名してください。',
          '',
          '✍️ 業務委託契約書（' + salesName + ' 様 専用・電子署名）',
          individualContractUrl,
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ② Chatworkグループへの参加',
          '━━━━━━━━━━━━━━━━━━━━',
          '下記のリンクからmono.create営業スタッフグループにご参加ください。',
          'グループ内にマニュアルも記載されていますので、必ずご確認ください。',
          '',
          '🔗 Chatworkグループ招待リンク（＆マニュアル）',
          SALES_CHATWORK_INVITE,
          '',
          '※ Chatworkのアカウントをお持ちでない場合は、',
          '  上記リンクから無料登録後にグループへご参加ください。',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '▼ ③ 中村のDMへの追加',
          '━━━━━━━━━━━━━━━━━━━━',
          'Chatworkで下記IDを検索し、ダイレクトメッセージから',
          '「営業スタッフとして採用いただきました〇〇です」とご連絡ください。',
          '',
          '💬 Chatwork ID：wl0b2t4akjur（mono.create 中村航汰）',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '不明点があればこのメールへ返信ください。',
          'よろしくお願いいたします。',
          '',
          '担当：mono.create 運営 中村航汰',
        ]
      );
    }

    // オーナーへ通知（営業スタッフ_全体連絡ルームへ）
    var salesNotifyRoom = SALES_ROOM_GENERAL || EDITOR_ROOM_ID || CHATWORK_ROOM_ID;
    if (salesNotifyRoom) {
      var cwMsg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '✅ 営業スタッフ採用決定 — 招待メール自動送信済み\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '日時    : ' + now + '\n' +
        '名前    : ' + salesName + '\n' +
        'メール  : ' + salesEmail + '\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
      try {
        UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + salesNotifyRoom + '/messages', {
          method: 'POST',
          headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
          payload: 'body=' + encodeURIComponent(cwMsg)
        });
      } catch(e) {}
    }
  }

  // ── 見送り → 不採用通知メール（初回のみ）──
  if (status === '見送り' && prevStatus !== '見送り') {
    var rowDataR    = sh.getRange(row, 1, 1, 13).getValues()[0];
    var salesNameR  = rowDataR[1] || '';
    var salesEmailR = rowDataR[4] || '';

    if (salesEmailR && salesEmailR.indexOf('@') !== -1) {
      sendAutoReply(salesEmailR, salesNameR,
        '【mono.create】営業スタッフご応募の選考結果について',
        [
          'この度はmono.createへのご応募いただきまして、',
          '誠にありがとうございます。',
          '',
          '慎重に選考を行いました結果、',
          '誠に残念ながら今回は採用を見送らせていただく',
          'こととなりました。',
          '',
          'ご応募いただいたご期待に添えず大変恐縮ですが、',
          '何卒ご了承くださいますようお願い申し上げます。',
          '',
          '今後の益々のご活躍をお祈り申し上げます。',
          '',
          '──────────────────────────',
          '※ 選考結果に関するご質問へのご回答は',
          '  いたしかねますのでご了承ください。',
          '──────────────────────────',
        ]
      );
    }
  }

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
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('payments');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteSales(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('uriage');
  if (!sheet) return jsonResponse({ error: 'sheet not found' });
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

function deleteInquiry(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
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
// 契約書ドキュメント保管フォルダを取得（なければ作成）
// My Drive ルート直下に「業務委託契約書」フォルダを使用
// ================================================================
function getOrCreateContractDocFolder() {
  var root = DriveApp.getRootFolder();
  var folders = root.getFoldersByName(CONTRACT_DOC_SUBFOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return root.createFolder(CONTRACT_DOC_SUBFOLDER_NAME);
}

// ================================================================
// .docx を Google Doc 形式に変換してコピー（Drive v3 API 使用）
// makeCopy() は .docx のままになるため、この関数で変換する
// ================================================================
function copyAsGoogleDoc(sourceFileId, title, folderId) {
  // テンプレートが .docx の場合: makeCopy してダウンロードURLを返す方式
  // （Drive API の変換コピーは当該ファイルでは非対応のため）
  var template = DriveApp.getFileById(sourceFileId);
  var folder   = DriveApp.getFolderById(folderId);
  var newFile  = template.makeCopy(title, folder);
  newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return newFile;
}

// ================================================================
// 営業スタッフ 個別契約書を自動作成
// .docx テンプレートを Google Doc 形式に変換してコピー → 誰でも開けるURL
// 戻り値: 個別契約書のURL（string）
// ================================================================
function createIndividualSalesContract(salesName, recipientEmail) {
  try {
    var dateStr  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var docTitle = '【営業契約書】' + salesName + '_' + dateStr;
    var folder   = getOrCreateContractDocFolder();
    // テンプレートコピー（setSharing済み）
    var newFile  = copyAsGoogleDoc(SALES_CONTRACT_TEMPLATE_ID, docTitle, folder.getId());
    // ダウンロードURL（.docx をブラウザで開こうとしないため確実に機能）
    return 'https://drive.google.com/uc?export=download&id=' + newFile.getId();
  } catch(e) {
    Logger.log('createIndividualSalesContract error: ' + e);
    return CONTRACT_DOC_FOLDER_URL;
  }
}

// ================================================================
// ※ 旧DocumentApp版（参考用・使用しない）
// ================================================================
function _createIndividualSalesContractDocApp_UNUSED(salesName) {
  try {
    var today     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日');
    var dateStr   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var docTitle  = '【営業契約書】' + salesName + '_' + dateStr;

    // DocumentApp で新規 Google Doc を作成（documents スコープ必要）
    var doc  = DocumentApp.create(docTitle);
    var body = doc.getBody();
    body.setMarginTop(50).setMarginBottom(50).setMarginLeft(50).setMarginRight(50);

    // ── タイトル ──
    body.appendParagraph('業務委託契約書（営業スタッフ）')
        .setHeading(DocumentApp.ParagraphHeading.HEADING1)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph(' ');

    // ── 甲乙 ──
    body.appendParagraph('甲：mono.create 代表　中村航汰（以下「甲」）');
    body.appendParagraph('乙：' + salesName + '　　　　　　　（以下「乙」）');
    body.appendParagraph(' ');
    body.appendParagraph('甲および乙は、以下の条件にて業務委託契約を締結する。');
    body.appendParagraph(' ');

    var articles = [
      ['第1条（目的）',
       '本契約は、甲が運営する動画編集・SNS運用代行サービス「mono.create」の営業・紹介活動を乙に委託することを目的とする。'],
      ['第2条（委託業務の内容）',
       '乙は以下の業務を行うものとする。\n' +
       '1.　mono.createのサービス（動画編集代行・SNS運用代行等）の営業・紹介活動\n' +
       '2.　見込みクライアントへのサービス説明および甲への取次ぎ\n' +
       '3.　甲が提供するマニュアル・資料に基づいた営業活動\n' +
       '4.　成約後のフォローアップ（甲の指示に基づく範囲内）'],
      ['第3条（成果報酬）',
       '１　乙の紹介により成約（甲への初回入金確認）した場合、以下の報酬を支払う。\n\n' +
       '　サービス種別　　　　　　　　　成約報酬\n' +
       '　ショート動画編集（単品）　　　¥1,000／件\n' +
       '　長尺動画編集（単品）　　　　　¥2,000／件\n' +
       '　まとめて編集プラン（月額）　　¥3,000／件\n' +
       '　投稿丸投げ・運用代行プラン　　¥5,000／件\n' +
       '　継続ボーナス（3ヶ月継続〜）　+¥1,000／件\n\n' +
       '２　報酬の発生条件は、乙が紹介したクライアントの初回入金が甲にて確認された時点とする。\n' +
       '３　支払いは月末締め翌月末払いとし、甲が指定する口座への振込にて行う。\n' +
       '４　振込手数料は乙の負担とする。\n' +
       '５　報酬が1,000円未満の場合、翌月以降に繰り越す。'],
      ['第4条（契約期間）',
       '１　本契約の有効期間は、契約締結日から1年間とする。\n' +
       '２　期間満了の1ヶ月前までに書面による解約申し出がない場合、同一条件にて自動更新する。'],
      ['第5条（業務の独立性）',
       '１　乙は独立した事業者として業務を遂行し、甲との間に雇用関係は一切生じない。\n' +
       '２　乙の業務に関連して発生した費用は、別途合意がない限り乙の負担とする。'],
      ['第6条（守秘義務）',
       '１　乙は、本契約の履行を通じて知り得た甲の秘密情報（顧客情報・料金体系・ノウハウ等）を第三者に開示・漏洩してはならない。\n' +
       '２　本条の義務は、本契約終了後も3年間継続する。'],
      ['第7条（禁止事項）',
       '乙は以下の行為を行ってはならない。\n' +
       '1.　甲の許可なく、甲の名称・ロゴ・資料を使用した営業活動\n' +
       '2.　虚偽・誇大な説明によるクライアントの誘引\n' +
       '3.　甲が競合と判断するサービスへの同時在籍・紹介活動\n' +
       '4.　本契約で委託された業務を第三者へ再委託すること\n' +
       '5.　甲のクライアント・見込みクライアントへの直接契約の誘引'],
      ['第8条（契約の解除）',
       '甲または乙は、相手方が本契約に違反した場合、即時に本契約を解除できる。'],
      ['第9条（損害賠償）',
       '乙が本契約に違反し、甲に損害を与えた場合、乙は甲に対して損害の賠償を行うものとする。'],
      ['第10条（反社会的勢力の排除）',
       '甲および乙は、現在および将来にわたって、反社会的勢力に該当しないことを相互に表明・保証する。'],
      ['第11条（合意管轄）',
       '本契約に関する紛争については、甲の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とする。'],
      ['第12条（協議事項）',
       '本契約に定めのない事項および疑義が生じた場合は、甲乙誠意をもって協議の上解決するものとする。'],
    ];

    articles.forEach(function(a) {
      var title = body.appendParagraph(a[0]);
      title.editAsText().setBold(true);
      title.setSpacingBefore(12);
      body.appendParagraph(a[1]).setSpacingAfter(6);
    });

    // ── 締結文 ──
    body.appendParagraph(' ');
    body.appendParagraph('以上の内容を証するため、本契約書を2通作成し、各自1通を保有する。');
    body.appendParagraph(' ');
    body.appendParagraph('締結日：　　　　年　　月　　日')
        .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    body.appendParagraph(' ');
    body.appendParagraph('甲：mono.create 代表　中村航汰　　　　㊞');
    body.appendParagraph(' ');
    body.appendParagraph('乙：' + salesName + '　　　　　　　　　㊞');
    body.appendParagraph('　住所：');
    body.appendParagraph('　生年月日：');

    doc.saveAndClose();

    // 共有設定
    var docFile = DriveApp.getFileById(doc.getId());
    docFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // 保管フォルダへ移動（可能な場合）
    try {
      var folder = getOrCreateContractDocFolder();
      folder.addFile(docFile);
      DriveApp.getRootFolder().removeFile(docFile);
    } catch(fe) { /* マイドライブのままでも問題なし */ }

    return 'https://docs.google.com/document/d/' + doc.getId() + '/edit?usp=sharing';
  } catch(e) {
    Logger.log('createIndividualSalesContract error: ' + e);
    return CONTRACT_DOC_FOLDER_URL;
  }
}

// ================================================================
// 個別編集者契約書を生成（テンプレートコピー方式）
// EDITOR_CONTRACT_TEMPLATE_ID は Google Doc のため makeCopy で Google Doc になる
// ================================================================
function createIndividualEditorContract(editorName, recipientEmail) {
  try {
    var dateStr  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var docTitle = '【編集者契約書】' + editorName + '_' + dateStr;
    var folder   = getOrCreateContractDocFolder();
    // 編集者テンプレートは Google Doc → makeCopy → Google Doc のままブラウザで開ける
    var newFile  = copyAsGoogleDoc(EDITOR_CONTRACT_TEMPLATE_ID, docTitle, folder.getId());
    return 'https://docs.google.com/document/d/' + newFile.getId() + '/edit?usp=sharing';
  } catch(e) {
    Logger.log('createIndividualEditorContract error: ' + e);
    return CONTRACT_DOC_FOLDER_URL;
  }
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
// ── 過去記録照合でトライアル自動判定 ─────────────────────────────────
function checkPastRecords(ss, email, name) {
  var sources   = [];
  var hasRecord = false;
  var emailNorm = (email || '').trim().toLowerCase();

  // 1. inquiriesシート：同メールが2件以上 → 過去に問い合わせあり
  try {
    var inqSheet = getOrCreateSheet();
    if (inqSheet && inqSheet.getLastRow() > 1) {
      var inqVals = inqSheet.getDataRange().getValues();
      var inqCount = 0;
      for (var i = 1; i < inqVals.length; i++) {
        var ie = (inqVals[i][3] || '').trim().toLowerCase(); // col4=メール
        if (emailNorm && ie === emailNorm) inqCount++;
      }
      if (inqCount > 1) {
        hasRecord = true;
        sources.push('過去の問い合わせ ' + (inqCount - 1) + '件');
      }
    }
  } catch(e) { Logger.log('checkPastRecords/inquiries: ' + e); }

  // 2. hearingsシート：同メールが既存 → 過去にヒアリング提出あり
  try {
    var hrSheet = ss.getSheetByName('hearings');
    if (hrSheet && hrSheet.getLastRow() > 1) {
      var hrVals = hrSheet.getDataRange().getValues();
      var hrCount = 0;
      for (var j = 1; j < hrVals.length; j++) {
        var he = (hrVals[j][2] || '').trim().toLowerCase(); // col3=メール
        if (emailNorm && he === emailNorm) hrCount++;
      }
      if (hrCount > 0) {
        hasRecord = true;
        sources.push('過去のヒアリング ' + hrCount + '件');
      }
    }
  } catch(e) { Logger.log('checkPastRecords/hearings: ' + e); }

  // 3. salesシート：同メール or 名前で売上記録あり
  try {
    var salesSheet = ss.getSheetByName('sales');
    if (salesSheet && salesSheet.getLastRow() > 1) {
      var sVals = salesSheet.getDataRange().getValues();
      for (var k = 1; k < sVals.length; k++) {
        var rowStr = sVals[k].join(' ').toLowerCase();
        if (emailNorm && rowStr.indexOf(emailNorm) >= 0) {
          hasRecord = true;
          sources.push('売上記録あり');
          break;
        }
      }
    }
  } catch(e) { Logger.log('checkPastRecords/sales: ' + e); }

  return { hasRecord: hasRecord, sources: sources };
}

// ── 問い合わせシートのトライアルフラグを自動更新 ─────────────────────────
function autoSetInquiryTrial(ss, emailNorm, trialValue) {
  try {
    var inqSheet = getOrCreateSheet();
    if (!inqSheet || inqSheet.getLastRow() < 2) return;
    var inqVals = inqSheet.getDataRange().getValues();
    // 末尾から検索して最新の同メール行を更新
    for (var i = inqVals.length - 1; i >= 1; i--) {
      var ie = (inqVals[i][3] || '').trim().toLowerCase();
      if (emailNorm && ie === emailNorm) {
        inqSheet.getRange(i + 1, 9).setValue(trialValue); // col9=trial
        break;
      }
    }
  } catch(e) { Logger.log('autoSetInquiryTrial: ' + e); }
}

function saveHearing(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('hearings');
  if (!sheet) {
    sheet = ss.insertSheet('hearings');
    sheet.appendRow(['受信日時','お名前','メール','プラン','回答JSON','ステータス','トライアル','初回申告','信頼度']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // ── トライアル自動判定 ─────────────────────────────────────────────
  var emailNorm   = (data.email || '').trim().toLowerCase();
  var isFirstTime = (data.isFirstTime === 'yes');
  var pastCheck   = checkPastRecords(ss, emailNorm, data.name || '');

  var trialValue, confidence;
  if (isFirstTime && !pastCheck.hasRecord) {
    trialValue = 'トライアル'; confidence = '高';          // 初回申告＋記録なし → 確定トライアル
  } else if (isFirstTime && pastCheck.hasRecord) {
    trialValue = 'トライアル'; confidence = '要確認';      // 初回申告だが記録あり → 要確認
  } else {
    trialValue = '';           confidence = '高';          // リピーター申告 → 通常
  }

  sheet.appendRow([
    now,
    data.name  || '',
    data.email || '',
    data.plan  || '',
    JSON.stringify(data.answers || {}),
    '未対応',
    trialValue,                          // col7: トライアル自動設定
    isFirstTime ? 'はい' : 'いいえ',    // col8: 初回自己申告
    confidence                           // col9: 信頼度
  ]);

  // 問い合わせシートのトライアルバッジも自動更新
  autoSetInquiryTrial(ss, emailNorm, trialValue);

  // Chatwork通知
  if (CHATWORK_ROOM_ID) {
    var trialLabel = trialValue
      ? ('🎁 トライアル（信頼度：' + confidence + (pastCheck.sources.length ? ' / ' + pastCheck.sources.join('、') : '') + '）')
      : '💰 通常（リピーター申告）';
    var lines = ['[To:' + CHATWORK_MENTION + '] 中村航汰', '',
      '━━━━━━━━━━━━━━━━━━━━',
      '📋 ヒアリングシート回答 — mono.create LP',
      '━━━━━━━━━━━━━━━━━━━━',
      '受信日時：' + now,
      'お名前  ：' + (data.name  || ''),
      'メール  ：' + (data.email || ''),
      'プラン  ：' + (data.plan  || ''),
      '判定    ：' + trialLabel,
      confidence === '要確認' ? '⚠️ 初回申告だが過去記録あり → 要確認' : '',
      '━━━━━━━━━━━━━━━━━━━━'
    ].filter(function(l){ return l !== ''; });
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
    data.push({ row:i+1, date:row[0]||'', name:row[1]||'', email:row[2]||'', plan:row[3]||'', answers:answers, status:row[5]||'未対応', trial:row[6]||'', isFirstTime:row[7]||'', confidence:row[8]||'' });
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

// ================================================================
// 経費帳（keiei）
// 取引日|相手先名|経費種別|摘要|金額|支払方法|備考
//   1      2       3       4    5      6       7
// 経費種別: パートナー報酬 / 外注費（編集者） / 広告宣伝費 / その他経費
// ================================================================

function getOrCreateKeieiSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('keiei');
  if (!sheet) {
    sheet = ss.insertSheet('keiei');
    sheet.appendRow(['取引日','相手先名','経費種別','摘要','金額','支払方法','備考']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,7).setFontWeight('bold');
    sheet.setColumnWidth(1,100); sheet.setColumnWidth(2,160);
    sheet.setColumnWidth(3,140); sheet.setColumnWidth(4,220);
    sheet.setColumnWidth(5,100); sheet.setColumnWidth(6,100);
    sheet.setColumnWidth(7,200);
  }
  return sheet;
}

// 経費を記録（手動入力 & 自動記帳共用）
function saveExpense(data) {
  var sheet = getOrCreateKeieiSheet();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  sheet.appendRow([
    data.date     || today,
    data.name     || '',
    data.category || 'その他経費',
    data.summary  || '',
    parseFloat(data.amount) || 0,
    data.method   || 'PayPay',
    data.note     || ''
  ]);
  return jsonResponse({ success: true });
}

// 経費一覧
function listExpenses() {
  var sheet  = getOrCreateKeieiSheet();
  var values = sheet.getDataRange().getValues();
  var data   = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:      i + 1,
      date:     r[0] || '',
      name:     r[1] || '',
      category: r[2] || '',
      summary:  r[3] || '',
      amount:   Number(r[4]) || 0,
      method:   r[5] || '',
      note:     r[6] || ''
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// 月次収支サマリー
function getMonthlySummary(monthStr) {
  // monthStr: "2026-05" 形式。空なら当月
  var now = new Date();
  var ym  = monthStr || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 売上合計
  var uriage = ss.getSheetByName('uriage');
  var salesTotal = 0;
  if (uriage) {
    var sv = uriage.getDataRange().getValues();
    for (var i = 1; i < sv.length; i++) {
      var d = sv[i][0] ? sv[i][0].toString().substring(0,7) : '';
      if (d === ym) salesTotal += Number(sv[i][6]) || 0; // 税込（7列目）
    }
  }

  // 経費合計
  var keiei = ss.getSheetByName('keiei');
  var expenseTotal = 0;
  var expenseByCategory = {};
  if (keiei) {
    var kv = keiei.getDataRange().getValues();
    for (var i = 1; i < kv.length; i++) {
      var d = kv[i][0] ? kv[i][0].toString().substring(0,7) : '';
      if (d === ym) {
        var amt = Number(kv[i][4]) || 0;
        var cat = kv[i][2] || 'その他';
        expenseTotal += amt;
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
      }
    }
  }

  return jsonResponse({
    month:    ym,
    sales:    salesTotal,
    expense:  expenseTotal,
    profit:   salesTotal - expenseTotal,
    margin:   salesTotal > 0 ? Math.round((salesTotal - expenseTotal) / salesTotal * 100) : 0,
    byCategory: expenseByCategory
  });
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

  // ⑧ パートナー報酬 自動計算（紹介コードがあれば）
  try {
    autoCreatePartnerRewardRecord(name, contact, plan);
  } catch(e) {
    Logger.log('パートナー報酬自動計算エラー: ' + e);
  }

  return jsonResponse({
    success: true,
    taxInc: taxInc,
    taxExc: taxExc,
    folderUrl: folderUrl,
    folderName: folderName,
  });
}

// ================================================================
// お詫び＋ヒアリングシート再送メール
// ================================================================
function sendApologyHearing(email, name, plan, planKey) {
  if (!email || email.indexOf('@') === -1) {
    return jsonResponse({ error: 'invalid email' });
  }

  var hearingPath = HEARING_MAP[planKey] || 'hearing/short.html';
  var hearingUrl  = LP_BASE_URL + hearingPath
    + '?name='    + encodeURIComponent(name)
    + '&email='   + encodeURIComponent(email)
    + '&plan='    + encodeURIComponent(plan || planKey)
    + '&planKey=' + encodeURIComponent(planKey);

  var displayName = name || 'お客様';
  var subject = '【お詫び】ヒアリングシートが正常に送信されなかった件について | mono.create';
  var body = [
    displayName + ' 様',
    '',
    'この度はmono.createをご利用いただき、誠にありがとうございます。',
    '代表の中村航汰です。',
    '',
    '先日ヒアリングシートにご入力いただいた際に、',
    'システムの不具合により送信が完了されなかった旨を確認いたしました。',
    '',
    'ご入力いただいたにもかかわらず、このようなご不便をおかけしてしまい、',
    '大変申し訳ございませんでした。',
    '',
    '以下のURLよりあらためてご記入いただけますと幸いです。',
    '（前回の入力内容は残っておりませんが、約5分で完了します）',
    '',
    '▼ ヒアリングシート（再送）',
    hearingUrl,
    '',
    'ご不明な点がございましたら、このメールへご返信いただくか、',
    'Chatwork（ID: wl0b2t4akjur）までお気軽にご連絡ください。',
    '',
    'この度はご迷惑をおかけし、誠に失礼いたしました。',
    'どうぞよろしくお願いいたします。',
    '',
    '─────────────────────',
    'mono.create 代表　中村 航汰',
    'Mail: mono.create.group@gmail.com',
    'Chatwork: wl0b2t4akjur',
    '─────────────────────',
  ].join('\n');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body,
    name: 'mono.create 中村航汰',
  });

  return jsonResponse({ success: true, hearingUrl: hearingUrl, sentTo: email });
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

// ================================================================
// 無料ポートフォリオ制作 管理
// pf_config シート: key | value の2列
// Keys: max_slots(合計), genres(JSON配列)
// genres JSON: [{name:"Vlog系", active:true, max:3, count:0}, ...]
// ================================================================

function getOrCreatePFConfigSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('pf_config');
  if (!sheet) {
    sheet = ss.insertSheet('pf_config');
    sheet.appendRow(['key','value']);
    sheet.appendRow(['max_slots','5']);
    var defaultGenres = [
      {name:'Vlog系',active:true,max:1,count:0},
      {name:'ビジネストーク系',active:true,max:1,count:0},
      {name:'エンタメトーク系',active:true,max:1,count:0},
      {name:'広告系',active:true,max:1,count:0},
      {name:'切り抜き系',active:true,max:1,count:0},
      {name:'企画系',active:true,max:1,count:0}
    ];
    sheet.appendRow(['genres', JSON.stringify(defaultGenres)]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreatePFSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('portfolio_free');
  if (!sheet) {
    sheet = ss.insertSheet('portfolio_free');
    sheet.appendRow(['日時','名前','メール','ジャンル','詳細','ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,6).setFontWeight('bold');
  }
  return sheet;
}

// config読み込み（実際のカウントをportfolio_freeシートから計算）
function getPFConfig() {
  var cfgSheet = getOrCreatePFConfigSheet();
  var pfSheet = getOrCreatePFSheet();
  var cfgValues = cfgSheet.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < cfgValues.length; i++) {
    cfg[cfgValues[i][0]] = cfgValues[i][1];
  }
  var maxSlots = parseInt(cfg['max_slots']) || 5;
  var genres = [];
  try { genres = JSON.parse(cfg['genres']); } catch(e) {}

  // portfolio_freeシートからジャンルごとのカウント・成約数を計算
  var pfValues = pfSheet.getDataRange().getValues();
  var genreCount = {};
  var genreContracted = {};
  for (var j = 1; j < pfValues.length; j++) {
    var genre = pfValues[j][3] || '';
    var status = pfValues[j][5] || '';
    if (!genre) continue;
    if (status !== 'キャンセル') {
      genreCount[genre] = (genreCount[genre] || 0) + 1;
    }
    if (status === '成約済み') {
      genreContracted[genre] = (genreContracted[genre] || 0) + 1;
    }
  }
  var totalCount = pfValues.length - 1;

  // genresにcount・contractedを注入
  genres = genres.map(function(g) {
    return {
      name: g.name,
      active: g.active !== false,
      max: g.max || 1,
      count: genreCount[g.name] || 0,
      contracted: genreContracted[g.name] || 0
    };
  });

  return jsonResponse({
    max_slots: maxSlots,
    total_count: totalCount,
    remaining: Math.max(0, maxSlots - totalCount),
    genres: genres
  });
}

function updatePFConfig(data) {
  var sheet = getOrCreatePFConfigSheet();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === 'max_slots' && data.max_slots !== undefined) {
      sheet.getRange(i+1, 2).setValue(String(data.max_slots));
    }
    if (values[i][0] === 'genres' && data.genres !== undefined) {
      sheet.getRange(i+1, 2).setValue(JSON.stringify(data.genres));
    }
  }
  return jsonResponse({ success: true });
}

function submitPFInquiry(data) {
  // スロットチェック（シートを直接参照）
  var pfSheet = getOrCreatePFSheet();
  var cfgSheet = getOrCreatePFConfigSheet();
  var cfgValues = cfgSheet.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < cfgValues.length; i++) {
    cfg[cfgValues[i][0]] = cfgValues[i][1];
  }
  var maxSlots = parseInt(cfg['max_slots']) || 5;
  var genres = [];
  try { genres = JSON.parse(cfg['genres']); } catch(e) {}

  var pfValues = pfSheet.getDataRange().getValues();
  var genreCount = {};
  var activeCount = 0;
  for (var j = 1; j < pfValues.length; j++) {
    var g = pfValues[j][3] || '';
    var st = pfValues[j][5] || '';
    if (st === 'キャンセル') continue;
    activeCount++;
    if (g) genreCount[g] = (genreCount[g] || 0) + 1;
  }
  var totalCount = activeCount;

  if (totalCount >= maxSlots) {
    return jsonResponse({ error: 'full', message: '受付が終了しました' });
  }

  var genre = data.genre || '';
  var genreObj = null;
  for (var k = 0; k < genres.length; k++) {
    if (genres[k].name === genre) { genreObj = genres[k]; break; }
  }
  if (!genreObj || genreObj.active === false) {
    return jsonResponse({ error: 'genre_unavailable', message: 'このジャンルは現在受け付けていません' });
  }
  var currentGenreCount = genreCount[genre] || 0;
  if (currentGenreCount >= (genreObj.max || 1)) {
    return jsonResponse({ error: 'genre_full', message: 'このジャンルは満席です' });
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  pfSheet.appendRow([now, data.name||'', data.email||'', genre, data.message||'', '未対応']);

  // Chatwork通知（メンション付き）
  if (CHATWORK_ROOM_ID) {
    var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '📸 無料PF制作：新規申込 — mono.create\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '受信日時 : ' + now + '\n' +
      '名前     : ' + (data.name||'') + '\n' +
      'メール   : ' + (data.email||'') + '\n' +
      'ジャンル : ' + genre + '\n' +
      (data.message ? '詳細     : ' + data.message + '\n' : '') +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
    try {
      UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages', {
        method:'POST', headers:{'X-ChatWorkToken':CHATWORK_TOKEN},
        payload:'body=' + encodeURIComponent(msg)
      });
    } catch(e){}
  }

  // ── オーナーへのGmailバックアップ通知 ──
  notifyOwnerEmail(
    '【無料PF制作申込】' + (data.name || '名前なし') + ' — ' + genre,
    [
      '受信日時 : ' + now,
      '名前     : ' + (data.name || ''),
      'メール   : ' + (data.email || '未入力'),
      'ジャンル : ' + genre,
      '',
      data.message ? '【詳細】\n' + data.message : '',
      '',
      '▶ 管理画面 (無料PF制作タブ): ' + LP_BASE_URL + 'admin.html',
    ]
  );

  // 自動返信
  if (data.email && data.email.indexOf('@') !== -1) {
    sendAutoReply(data.email, data.name,
      '【mono.create】無料ポートフォリオ制作のお申し込みを受け付けました',
      [
        'この度は無料ポートフォリオ制作にお申し込みいただき、誠にありがとうございます。',
        '',
        '▼ ご申込内容',
        'ジャンル: ' + genre,
        '',
        '内容を確認の上、1〜2営業日以内にヒアリングシートURLをお送りします。',
        'いましばらくお待ちください。',
        '',
        '【ご確認事項】',
        '・制作した動画はmono.createのポートフォリオとして掲載させていただきます',
        '・素材のご提供・ご指示をいただいた後、3〜4日以内に納品いたします',
      ]
    );
  }

  return jsonResponse({ success: true });
}

function listPFInquiries() {
  var sheet = getOrCreatePFSheet();
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({ row:i+1, date:r[0]||'', name:r[1]||'', email:r[2]||'', genre:r[3]||'', message:r[4]||'', status:r[5]||'未対応' });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

function updatePFStatus(row, status) {
  var sheet = getOrCreatePFSheet();
  sheet.getRange(row, 6).setValue(status);
  return jsonResponse({ success: true });
}

function deletePFInquiry(row) {
  if (!row || row < 2) return jsonResponse({ error: 'invalid row' });
  var sheet = getOrCreatePFSheet();
  sheet.deleteRow(row);
  return jsonResponse({ success: true });
}

// ── パートナー申請 一覧取得 ────────────────────────────────────
// partner_applications シート列:
// 受信日時|名前|メール|種別|URL|フォロワー・PV|紹介方法|発行コード|X|メッセージ|ステータス
//    1      2    3     4    5      6               7         8         9    10         11
function listPartnerApplications() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('partner_applications');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:          i + 1,
      date:         r[0]  || '',
      name:         r[1]  || '',
      email:        r[2]  || '',
      partner_type: r[3]  || '',
      url:          r[4]  || '',
      audience:     r[5]  || '',
      method:       r[6]  || '',
      code:         r[7]  || '',
      twitter:      r[8]  || '',
      message:      r[9]  || '',
      status:       r[10] || '未対応'
    });
  }
  data.sort(function(a, b) { return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

function updatePartnerAppStatus(row, status) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('partner_applications');
  if (!sh) return jsonResponse({ success: true });
  sh.getRange(row, 11).setValue(status);  // 11列目=ステータス

  // 承認時 → 専用コード発行メールを自動送信
  if (status === '承認') {
    var rowData = sh.getRange(row, 1, 1, 11).getValues()[0];
    var partnerName  = rowData[1] || '';
    var partnerEmail = rowData[2] || '';
    var partnerCode  = rowData[7] || '';
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    if (partnerEmail && partnerEmail.indexOf('@') !== -1) {
      var subject = '【mono.create】パートナー承認 — 専用紹介コードを発行しました';
      var body = [
        partnerName + ' 様',
        '',
        'この度はmono.createパートナープログラムへのご登録ありがとうございます。',
        '審査が完了し、パートナーとして承認されました！',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ あなた専用の紹介コード',
        '━━━━━━━━━━━━━━━━━━━━',
        '',
        '  【 ' + partnerCode + ' 】',
        '',
        '紹介先の方がお問い合わせフォームにこのコードを入力すると：',
        '  ✅ 紹介された方：通常価格から+5%OFF（最大15%OFF）',
        '  ✅ あなた（パートナー）：成約のたびに報酬をお支払い',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ 成約報酬テーブル（銀行振込）',
        '━━━━━━━━━━━━━━━━━━━━',
        '  ショート動画編集（単品）  ¥500 / 件',
        '  長尺動画・編集セット      ¥1,500 / 件',
        '  月額パック・運用代行      ¥3,000 / 件',
        '  継続ボーナス（月額パック3ヶ月〜） +¥1,000 / 件',
        '',
        '  ※ 継続ボーナスは月額パック・運用代行プランのみ対象です。',
        '  ※ 報酬は成約確認後14日以内に銀行振込でお支払いします。',
        '  ※ 割引は初回ご成約時のみ適用されます。',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '▼ コードの使い方',
        '━━━━━━━━━━━━━━━━━━━━',
        '1. 上記コードをSNS・サイト・DMなどで紹介先に共有',
        '2. 紹介先がお問い合わせ時にコードを入力（自動でOFF適用）',
        '3. 成約確認後14日以内に銀行振込で報酬をお支払い',
        '',
        '報酬確定時は別途メールにてご連絡します。',
        '引き続きよろしくお願いいたします。',
        '',
        '担当：mono.create 運営',
      ].join('\n');

      MailApp.sendEmail({
        to:      partnerEmail,
        subject: subject,
        body:    body,
        name:    'mono.create',
        replyTo: OWNER_EMAIL
      });
    }

    // 管理者にも通知
    notifyOwnerEmail(
      '【パートナー承認】' + partnerName + ' — コード: ' + partnerCode,
      [
        '承認日時 : ' + now,
        '名前     : ' + partnerName,
        'メール   : ' + partnerEmail,
        '発行コード: ' + partnerCode,
        '',
        '→ 承認メールを自動送信しました。',
      ]
    );
  }

  return jsonResponse({ success: true });
}

// ================================================================
// ── パートナー報酬 自動計算システム ─────────────────────────────
// partner_rewards シート:
// 受信日時|パートナー名|パートナーメール|紹介コード|クライアント名|プラン|基本報酬|継続ボーナス|合計報酬|ステータス
//    1         2            3              4           5           6      7        8            9         10
// ================================================================

function getOrCreatePartnerRewardsSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('partner_rewards');
  if (!sheet) {
    sheet = ss.insertSheet('partner_rewards');
    sheet.appendRow([
      '受信日時','パートナー名','パートナーメール','紹介コード',
      'クライアント名','プラン','基本報酬','継続ボーナス','合計報酬','ステータス'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,10).setFontWeight('bold');
  }
  return sheet;
}

// プラン文字列から基本報酬を返す
function calcRewardFromPlan(plan) {
  var p = (plan || '').toString();
  // 月額パック・運用代行（最優先）
  if (p.match(/月額|運用|パック|ops|pack/i)) return 3000;
  // 長尺・YouTube・セット
  if (p.match(/長尺|youtube|long|セット|set/i)) return 1500;
  // ショート・単品
  return 500;
}

// 同パートナーコードの月額成約件数をカウント → 継続ボーナス判定
function calcContinuityBonus(partnerCode) {
  var sheet = getOrCreatePartnerRewardsSheet();
  var values = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < values.length; i++) {
    if (values[i][3] === partnerCode) {                         // 紹介コード一致
      var plan = (values[i][5] || '').toString();
      if (plan.match(/月額|運用|パック/)) count++;               // 月額プランのみカウント
    }
  }
  // 4件目以降は継続ボーナス対象（＝過去3件+今回が4件目から）
  return count >= 3 ? 1000 : 0;
}

// inquiriesシートからクライアント名/メールで紹介コードを検索
function findReferralCodeByClient(clientName, clientEmail) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return '';
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var name  = (values[i][1] || '').toString().trim();
    var email = (values[i][3] || '').toString().trim();
    var code  = (values[i][9] || '').toString().trim();
    if (!code) continue;
    if ((clientName && name === clientName.trim()) ||
        (clientEmail && email === clientEmail.trim())) {
      return code;
    }
  }
  return '';
}

// partner_applicationsシートから紹介コードでパートナー情報を取得
function findPartnerByCode(code) {
  if (!code) return null;
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('partner_applications');
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if ((values[i][7] || '').toString().trim() === code.trim()) {
      return { row: i + 1, name: values[i][1] || '', email: values[i][2] || '', code: code };
    }
  }
  return null;
}

// 振込承認時に自動呼び出し → 報酬レコード作成
function autoCreatePartnerRewardRecord(clientName, clientEmail, plan) {
  var code = findReferralCodeByClient(clientName, clientEmail);
  if (!code) return;  // 紹介コードなし → スキップ

  var partner = findPartnerByCode(code);
  if (!partner) return;  // パートナー不明 → スキップ

  var base    = calcRewardFromPlan(plan);
  var bonus   = (plan.match(/月額|運用|パック/i)) ? calcContinuityBonus(code) : 0;
  var total   = base + bonus;
  var now     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  var sheet = getOrCreatePartnerRewardsSheet();
  sheet.appendRow([
    now, partner.name, partner.email, code,
    clientName, plan, base, bonus, total, '未送信'
  ]);

  // オーナーへ通知（Chatwork）
  var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '💰 パートナー報酬が自動計算されました\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'パートナー : ' + partner.name + '\n' +
    'クライアント: ' + clientName + '\n' +
    'プラン     : ' + plan + '\n' +
    '報酬額     : ¥' + total + '（基本¥' + base + (bonus ? ' + ボーナス¥' + bonus : '') + '）\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '▶ 管理画面で報酬メールを送信してください\n' +
    LP_BASE_URL + 'admin.html';
  try {
    UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages', {
      method: 'POST',
      headers: { 'X-ChatWorkToken': CHATWORK_TOKEN },
      payload: { body: msg, self_unread: 1 }
    });
  } catch(e) {}
}

// 報酬一覧を返す
function listPartnerRewards() {
  var sheet  = getOrCreatePartnerRewardsSheet();
  var values = sheet.getDataRange().getValues();
  var data   = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:      i + 1,
      date:     r[0]  || '',
      pName:    r[1]  || '',
      pEmail:   r[2]  || '',
      code:     r[3]  || '',
      client:   r[4]  || '',
      plan:     r[5]  || '',
      base:     r[6]  || 0,
      bonus:    r[7]  || 0,
      total:    r[8]  || 0,
      status:   r[9]  || '未送信'
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

// 報酬確定メール自動送信（admin操作）
function sendPartnerRewardEmailAuto(row) {
  var sheet   = getOrCreatePartnerRewardsSheet();
  var rowData = sheet.getRange(row, 1, 1, 10).getValues()[0];
  var pName   = rowData[1] || '';
  var pEmail  = rowData[2] || '';
  var code    = rowData[3] || '';
  var client  = rowData[4] || '';
  var plan    = rowData[5] || '';
  var base    = rowData[6] || 0;
  var bonus   = rowData[7] || 0;
  var total   = rowData[8] || 0;
  var now     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  if (!pEmail || pEmail.indexOf('@') === -1) return jsonResponse({ error: 'no email' });
  if (rowData[9] !== '未送信') return jsonResponse({ error: 'already_sent' });

  var bonusLine = bonus > 0
    ? ['', '⭐ 継続ボーナス（3ヶ月以上）: +¥' + bonus, '   合計報酬            : ¥' + total]
    : [];

  var body = [
    pName + ' 様',
    '',
    'お世話になっております。mono.createです。',
    'この度は紹介のご協力、誠にありがとうございます。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '▼ 成約報酬のご連絡',
    '━━━━━━━━━━━━━━━━━━━━',
    '紹介コード  : ' + code,
    'ご成約プラン: ' + plan,
    'クライアント: ' + client + ' 様',
    '',
    '基本報酬    : ¥' + base,
  ].concat(bonusLine).concat([
    '',
    '【お支払い報酬額】 ¥' + total,
    '【お支払い方法】   銀行振込',
    '【お支払い時期】   ' + now + ' より14日以内',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '▼ 振込先口座',
    '━━━━━━━━━━━━━━━━━━━━',
    BANK_INFO,
    '',
    '恐れ入りますが、振込手数料はご負担をお願いいたします。',
    'お振込完了後、このメールにご返信いただけますと幸いです。',
    '',
    'ご不明な点はいつでもご返信ください。',
    'よろしくお願いいたします。',
    '',
    '担当：mono.create 運営',
  ]);

  MailApp.sendEmail({
    to:      pEmail,
    subject: '【mono.create】成約報酬のご連絡 — ¥' + total + ' をお支払いします',
    body:    body.join('\n'),
    name:    'mono.create',
    replyTo: OWNER_EMAIL
  });

  // ステータス更新
  sheet.getRange(row, 10).setValue('メール済み');

  notifyOwnerEmail(
    '【報酬メール送信済み】' + pName + ' — ¥' + total,
    ['パートナー: ' + pName, '報酬額: ¥' + total, 'プラン: ' + plan, 'クライアント: ' + client]
  );

  return jsonResponse({ success: true });
}

// 支払済みマーク → 経費帳に自動記帳
function markRewardPaid(row) {
  var sheet   = getOrCreatePartnerRewardsSheet();
  var rowData = sheet.getRange(row, 1, 1, 10).getValues()[0];
  var pName   = rowData[1] || '';
  var total   = Number(rowData[8]) || 0;
  var plan    = rowData[5] || '';
  var code    = rowData[3] || '';
  var client  = rowData[4] || '';

  // ステータス更新
  sheet.getRange(row, 10).setValue('支払済み');

  // 経費帳に自動記帳
  try {
    saveExpense({
      date:     Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd'),
      name:     pName,
      category: 'パートナー報酬',
      summary:  '紹介料 ' + pName + ' — ' + plan + '（' + client + ' 様成約 / コード:' + code + '）',
      amount:   total,
      method:   '銀行振込',
      note:     '自動記帳'
    });
  } catch(e) {
    Logger.log('経費自動記帳エラー: ' + e);
  }

  notifyOwnerEmail(
    '【報酬支払済み＆経費記帳】' + pName + ' — ¥' + total,
    ['パートナー: ' + pName, '報酬額: ¥' + total, 'プラン: ' + plan, '経費帳: 自動記帳済み']
  );
  return jsonResponse({ success: true });
}

// 報酬確定メール送信（旧来の手動版・互換性維持）
function sendPartnerReward(row, amount) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('partner_applications');
  if (!sh) return jsonResponse({ error: 'sheet not found' });
  var rowData = sh.getRange(row, 1, 1, 11).getValues()[0];
  var partnerName  = rowData[1] || '';
  var partnerEmail = rowData[2] || '';
  var partnerCode  = rowData[7] || '';
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  if (!partnerEmail || partnerEmail.indexOf('@') === -1) {
    return jsonResponse({ error: 'no email' });
  }

  var subject = '【mono.create】成約報酬のご連絡 — ¥' + amount + ' をお支払いします';
  var body = [
    partnerName + ' 様',
    '',
    'お世話になっております。mono.createです。',
    '',
    'この度は紹介のご協力ありがとうございます。',
    '成約が確定しましたので、下記の通り報酬をお支払いします。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '▼ 報酬詳細',
    '━━━━━━━━━━━━━━━━━━━━',
    '報酬金額  : ¥' + amount,
    '支払方法  : PayPay送金',
    '支払時期  : ' + now + ' 前後（14日以内）',
    '紹介コード: ' + partnerCode,
    '',
    'PayPayのQRコードまたはIDをこのメールに返信してお知らせください。',
    '',
    'ご不明な点がございましたら、このメールへご返信ください。',
    'よろしくお願いいたします。',
    '',
    '担当：mono.create 運営',
  ].join('\n');

  MailApp.sendEmail({
    to:      partnerEmail,
    subject: subject,
    body:    body,
    name:    'mono.create',
    replyTo: OWNER_EMAIL
  });

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
// ██████████████████████████████████████████████████████████████
//  LINE Messaging API Webhook ハンドラー
// ██████████████████████████████████████████████████████████████
// ================================================================

/**
 * LINE からの Webhook イベントを処理する
 * @param {Object} payload - LINE の Webhook ペイロード（events 配列あり）
 */
// ================================================================
// LINE テンプレート定義（管理画面から送信可能）
// {{name}} {{url}} などのプレースホルダーが使えます
// ================================================================
var LINE_TEMPLATES = [
  {
    id: 'inquiry_received',
    category: '📩 問い合わせ',
    name: 'お問い合わせ受付',
    text: '{{name}}様\n\nmono.createへのお問い合わせありがとうございます！\n\n内容を確認し、1〜2営業日以内にご連絡いたします😊\n\n今後はこのLINEにてやり取りいたしますので、よろしくお願いいたします！\n\n追加のご質問などあればいつでもどうぞ🙌'
  },
  {
    id: 'trial_start',
    category: '🎬 トライアル',
    name: 'トライアル開始のご案内',
    text: '{{name}}様\n\nお問い合わせいただきありがとうございます！\n\nまずはトライアルとして1本制作させていただきます。\n\n以下のヒアリングシートにご記入いただけますでしょうか📝\n\n{{url}}\n\n（3〜5分で完了します）よろしくお願いいたします！'
  },
  {
    id: 'trial_delivered',
    category: '🎬 トライアル',
    name: 'トライアル納品',
    text: '{{name}}様\n\nトライアル動画を納品いたしました🎉\n\n{{url}}\n\nご確認いただき、ご感想やご意見をこのLINEにてお聞かせください！\n修正がある場合は「修正」とお送りいただくとフォームURLをお送りします😊'
  },
  {
    id: 'delivered',
    category: '📦 納品',
    name: '通常納品',
    text: '{{name}}様\n\n納品いたしました！\n\n{{url}}\n\nご確認をお願いいたします🙏\n修正がある場合は「修正」とお送りください。\n（1週間以内にご連絡いただけると助かります）'
  },
  {
    id: 'fix_done',
    category: '✅ 修正',
    name: '修正完了',
    text: '{{name}}様\n\nご指摘いただいた修正が完了しました！\n\n{{url}}\n\nご確認をお願いいたします🙏\nご不明な点があればお気軽にご連絡ください！'
  },
  {
    id: 'hearing_request',
    category: '📋 ヒアリング',
    name: 'ヒアリング依頼',
    text: '{{name}}様\n\nご依頼ありがとうございます！\n\n制作に進む前に、以下のヒアリングシートへのご記入をお願いいたします📝\n\n{{url}}\n\n（5分ほどで完了します）\nご不明な点はこのLINEにてお聞きください😊'
  },
  {
    id: 'invoice_request',
    category: '💳 請求',
    name: '振込依頼',
    text: '{{name}}様\n\nお見積もりをご確認いただきありがとうございます。\n\n以下の口座へお振込みをお願いいたします💳\n\n【振込先】\nPayPay銀行 うぐいす支店 008\n普通 4220331\nナカムラ コウタ\n\nご入金確認後、制作を開始いたします。\nよろしくお願いいたします！'
  },
  {
    id: 'contract_request',
    category: '📝 契約',
    name: '契約書署名依頼',
    text: '{{name}}様\n\n業務委託契約書をお送りいたします。\n\n{{url}}\n\n内容をご確認いただき、ご署名をお願いいたします。\nご不明な点があればこのLINEにてお気軽にお申し付けください😊'
  },
  {
    id: 'production_start',
    category: '🚀 制作',
    name: '制作開始のご連絡',
    text: '{{name}}様\n\nご入金を確認いたしました！ありがとうございます🙏\n\n制作を開始いたします。\n納期：{{url}}\n\nご不明な点はこのLINEにてお気軽にご連絡ください！'
  },
  {
    id: 'next_order',
    category: '🔄 継続',
    name: '次回発注のご案内',
    text: '{{name}}様\n\nいつもご利用いただきありがとうございます！\n\n次回のご依頼はこちらから承ります👇\n{{url}}\n\nリピーター割引（10%）が自動適用されます🎁\nよろしくお願いいたします！'
  },
  {
    id: 'partner_invite',
    category: '🤝 パートナー',
    name: 'パートナー紹介のご案内',
    text: '{{name}}様\n\nmono.createのパートナープログラムのご案内です💡\n\n動画制作が必要なクライアント様をご紹介いただくと、成約ごとに報酬（10〜15%）をお支払いしております。\n\n詳細はこちら👇\n{{url}}\n\nご興味があればぜひお気軽にご連絡ください！'
  },
  {
    id: 'free_text',
    category: '✏️ 自由入力',
    name: '自由入力',
    text: ''
  }
];

// LINE管理者プッシュ（管理画面から任意のUID宛に送信）
function adminLinePush(data) {
  var uid  = data.line_uid || '';
  var text = data.text     || '';
  if (!uid)  return jsonResponse({ error: 'line_uid が必要です' });
  if (!text) return jsonResponse({ error: 'text が必要です' });
  if (text.length > 5000) return jsonResponse({ error: 'テキストが長すぎます（5000文字以内）' });
  var result = pushToLine(uid, [{ type: 'text', text: text }]);
  if (result && !result.ok) {
    return jsonResponse({ success: false, line_status: result.status, line_error: result.body });
  }
  return jsonResponse({ success: true });
}

// ================================================================
function handleLineWebhook(payload) {
  var events = payload.events || [];
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    try {
      if (event.type === 'message' && event.message && event.message.type === 'text') {
        handleLineTextMessage(event);
      } else if (event.type === 'postback') {
        handleLinePostback(event);
      } else if (event.type === 'follow') {
        handleLineFollow(event);
      }
    } catch(e) {
      Logger.log('LINE event error: ' + e + ' / event: ' + JSON.stringify(event));
    }
  }
  // LINE には 200 OK を返すだけでよい
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * テキストメッセージを処理
 */
function handleLineTextMessage(event) {
  var text       = (event.message.text || '').trim();
  var replyToken = event.replyToken || '';
  var userId     = (event.source && event.source.userId) || '';
  var lowerText  = text.toLowerCase();

  // 自分のLINE UIDを確認（オーナー設定用）
  if (lowerText === 'myid' || lowerText === 'my id' || lowerText === '自分のid') {
    replyToLine(replyToken, [{ type: 'text', text: 'あなたのLINE UID:\n' + userId }]);
    return;
  }

  // 追加発注キーワード
  if (lowerText.indexOf('追加発注') >= 0 || lowerText.indexOf('追加注文') >= 0 ||
      lowerText.indexOf('依頼') >= 0    || lowerText.indexOf('発注') >= 0) {
    var orderUrl = LP_BASE_URL + 'additional-order.html?uid=' + encodeURIComponent(userId);
    replyToLine(replyToken, [
      {
        type: 'text',
        text: '追加のご依頼ありがとうございます！\n\n以下のフォームから内容をご記入ください👇\n\n' + orderUrl + '\n\n（本数・素材URL・希望納期をご入力いただくだけで完了です）'
      }
    ]);
    return;
  }

  // FBキーワード
  if (lowerText.indexOf('フィードバック') >= 0 || lowerText.indexOf('fb') >= 0 ||
      lowerText.indexOf('修正') >= 0) {
    var fbUrl = LP_BASE_URL + 'feedback.html?uid=' + encodeURIComponent(userId);
    replyToLine(replyToken, [
      {
        type: 'text',
        text: '修正・フィードバックはこちらのフォームからご記入ください👇\n\n' + fbUrl + '\n\n動画を見ながら修正箇所を記入できます。\n納品URLと動画の種類（ショート/長尺）を選んで開始してください！'
      }
    ]);
    return;
  }

  // メニュー表示
  if (text === 'メニュー' || text === 'menu' || text === 'help' || text === 'ヘルプ') {
    replyToLine(replyToken, [
      {
        type: 'text',
        text: '【mono.create メニュー】\n\n📦 追加のご依頼\n→「追加発注」と送信\n\n✏️ 修正・フィードバック\n→「修正」と送信\n\n💬 何でもご相談\n→ このLINEにそのままメッセージをどうぞ！\n\n全てこのLINEで完結します😊'
      }
    ]);
    return;
  }

  // その他（LINEで完結させる）
  replyToLine(replyToken, [
    {
      type: 'text',
      text: 'メッセージありがとうございます😊\n\n追加のご依頼 → 「追加発注」\n修正・FB → 「修正」\n\nその他のご相談はそのままこのトークにメッセージをお送りください！'
    }
  ]);
}

/**
 * ポストバック（リッチメニューボタン）を処理
 */
function handleLinePostback(event) {
  var data       = (event.postback && event.postback.data) || '';
  var replyToken = event.replyToken || '';
  var userId     = (event.source && event.source.userId) || '';

  if (data === 'action=additional_order') {
    var orderUrl = LP_BASE_URL + 'additional-order.html?uid=' + encodeURIComponent(userId);
    replyToLine(replyToken, [
      {
        type: 'text',
        text: '追加発注フォームはこちらです👇\n\n' + orderUrl
      }
    ]);
  }
}

/**
 * 友だち追加イベント
 */
function handleLineFollow(event) {
  var replyToken = event.replyToken || '';
  replyToLine(replyToken, [
    {
      type: 'text',
      text: '友だち追加ありがとうございます！\nmono.create です😊\n\n追加のご依頼 → 「追加発注」\n修正・フィードバック → 「修正」\nその他ご相談 → そのままメッセージをどうぞ！\n\n全てこのLINEで完結しますので、お気軽にご連絡ください🙌'
    }
  ]);
}

/**
 * LINE Reply API を呼び出す
 */
function replyToLine(replyToken, messages) {
  if (!replyToken || !LINE_CHANNEL_ACCESS_TOKEN) return;
  try {
    UrlFetchApp.fetch(LINE_REPLY_API, {
      method:  'post',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages:   messages
      }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('LINE reply error: ' + e);
  }
}

/**
 * LINE Push API（任意のユーザーへプッシュ送信）
 */
function pushToLine(userId, messages) {
  if (!userId || !LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, status: 0, body: 'no token' };
  try {
    var res = UrlFetchApp.fetch(LINE_PUSH_API, {
      method:  'post',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
      },
      payload: JSON.stringify({
        to:       userId,
        messages: messages
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('LINE push status:' + code + ' body:' + body);
    return { ok: code === 200, status: code, body: body };
  } catch(e) {
    Logger.log('LINE push error: ' + e);
    return { ok: false, status: 0, body: String(e) };
  }
}

// ================================================================
// 追加発注フォーム（additional-order.html から POST される）
// ================================================================
// シート: additional_orders
// 列: 受信日時|LINE UserID|名前|メール|本数|素材URL|希望納期|プラン|メモ|ステータス
function saveAdditionalOrder(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('additional_orders');
  if (!sheet) {
    sheet = ss.insertSheet('additional_orders');
    sheet.appendRow([
      '受信日時','LINE UserID','名前','メール','本数','素材URL','希望納期','プラン','メモ','ステータス'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.line_uid   || '',
    data.name       || '',
    data.email      || '',
    data.count      || '',
    data.material_url || '',
    data.due_date   || '',
    data.plan       || '',
    data.note       || '',
    '未対応'
  ]);

  // Chatwork 通知
  if (CHATWORK_ROOM_ID) {
    var msg = '[To:' + CHATWORK_MENTION + '] 中村航汰\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '📦 追加発注 — LINE経由 mono.create\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '受信日時  : ' + now + '\n' +
      '名前      : ' + (data.name || '') + '\n' +
      'メール    : ' + (data.email || '') + '\n' +
      'プラン    : ' + (data.plan || '') + '\n' +
      '本数      : ' + (data.count || '') + '\n' +
      '素材URL   : ' + (data.material_url || '') + '\n' +
      '希望納期  : ' + (data.due_date || '') + '\n' +
      (data.note ? 'メモ      : ' + data.note + '\n' : '') +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html';
    try {
      UrlFetchApp.fetch(
        'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages',
        { method: 'post', headers: { 'X-ChatWorkToken': CHATWORK_TOKEN }, payload: { body: msg } }
      );
    } catch(e) {}
  }

  // クライアントへ返信（LINE優先、メールフォールバック）
  notifyClientLineOrEmail(
    data.line_uid || '',
    data.email || '',
    data.name || '',
    '追加発注を受け付けました！\n\n' +
      '📦 内容確認\n' +
      'プラン   : ' + (data.plan  || '') + '\n' +
      '本数     : ' + (data.count || '') + '\n' +
      '希望納期 : ' + (data.due_date || '') + '\n\n' +
      '内容を確認の上、1〜2営業日以内にご連絡いたします。\nよろしくお願いいたします！',
    '【mono.create】追加発注を受け付けました',
    [
      '追加のご依頼ありがとうございます！',
      '内容を確認の上、1〜2営業日以内にご連絡いたします。',
      '',
      '▼ ご注文内容',
      'プラン  : ' + (data.plan  || ''),
      '本数    : ' + (data.count || ''),
      '素材URL : ' + (data.material_url || ''),
      '希望納期: ' + (data.due_date || ''),
      data.note ? 'メモ    : ' + data.note : '',
      '',
      '担当：mono.create 中村航汰',
    ]
  );

  // オーナーへメール通知
  notifyOwnerEmail(
    '【追加発注】' + (data.name || '名前なし') + ' — ' + (data.plan || '') + ' ' + (data.count || ''),
    [
      '受信日時  : ' + now,
      '名前      : ' + (data.name || ''),
      'メール    : ' + (data.email || '未入力'),
      'プラン    : ' + (data.plan || ''),
      '本数      : ' + (data.count || ''),
      '素材URL   : ' + (data.material_url || ''),
      '希望納期  : ' + (data.due_date || ''),
      (data.note ? 'メモ      : ' + data.note : ''),
      '',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
    ]
  );

  return jsonResponse({ success: true });
}

function listAdditionalOrders() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('additional_orders');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    data.push({
      row:          i + 1,
      date:         r[0] || '',
      line_uid:     r[1] || '',
      name:         r[2] || '',
      email:        r[3] || '',
      count:        r[4] || '',
      material_url: r[5] || '',
      due_date:     r[6] || '',
      plan:         r[7] || '',
      note:         r[8] || '',
      status:       r[9] || '未対応'
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
}

function updateAdditionalOrderStatus(row, status) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('additional_orders');
  if (!sh) return jsonResponse({ error: 'sheet not found' });
  sh.getRange(row, 10).setValue(status);
  return jsonResponse({ success: true });
}

// ================================================================
// FBページ（専用フィードバックフォーム）
// ================================================================
// シート: feedbacks
// 列: 受信日時|クライアント名|メール|納品URL|フィードバックJSON|ラウンド|ステータス
function saveFeedback(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('feedbacks');
  if (!sheet) {
    sheet = ss.insertSheet('feedbacks');
    sheet.appendRow([
      '受信日時','クライアント名','メール','納品URL','フィードバックJSON','ラウンド','ステータス'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    now,
    data.client_name  || '',
    data.email        || '',
    data.delivery_url || '',
    JSON.stringify(data.items || []),
    data.round        || '1',
    '未対応'
  ]);

  // オーナーへメール通知（編集者共有URLも含む）
  var fbItems = data.items || [];
  var fbItemLines = fbItems.map(function(it, idx) {
    return '修正' + (idx+1) + ': ' + (it.time || '—') + '\n' + (it.comment || '');
  }).join('\n\n');

  // 編集者共有URL生成（?review=1 形式）
  var reviewUrl = '';
  try {
    var itemsJson = JSON.stringify(fbItems);
    var itemsB64  = Utilities.base64Encode(itemsJson, Utilities.Charset.UTF_8);
    reviewUrl = LP_BASE_URL + 'feedback.html' +
      '?review=1' +
      '&video=' + encodeURIComponent(data.delivery_url || '') +
      '&items=' + encodeURIComponent(itemsB64) +
      '&name='  + encodeURIComponent(data.client_name || '') +
      '&round=' + encodeURIComponent(data.round || '1') +
      '&type='  + (data.video_type || 'short');
  } catch(e) { Logger.log('reviewUrl build error: ' + e); }

  notifyOwnerEmail(
    '【FBシート受信】' + (data.client_name || '') + ' / ' + (data.round || '1') + 'ラウンド目',
    [
      '受信日時    : ' + now,
      'クライアント: ' + (data.client_name || ''),
      'ラウンド    : ' + (data.round || '1') + 'ラウンド目',
      '修正件数    : ' + fbItems.length + '件',
      '納品URL     : ' + (data.delivery_url || ''),
      '━━━━━━━━━━━━━━━━',
      '',
      fbItemLines,
      '',
      '━━━━━━━━━━━━━━━━',
      '▶ 管理画面: ' + LP_BASE_URL + 'admin.html',
      '',
      '📤 編集者共有URL（このリンクを編集者に転送してください）:',
      reviewUrl,
    ]
  );

  // クライアントへ返信（LINE優先、メールフォールバック）
  notifyClientLineOrEmail(
    data.line_uid || '',
    data.email || '',
    data.client_name || '',
    'フィードバックを受け付けました！\n\n' +
      '修正件数: ' + (data.items || []).length + '件\n\n' +
      '内容を確認の上、修正版を納品いたします。\nよろしくお願いいたします！',
    '【mono.create】フィードバックを受け付けました',
    [
      'フィードバックをご記入いただきありがとうございます。',
      '内容を確認の上、修正版を納品いたします。',
      '',
      '修正件数: ' + (data.items || []).length + '件',
      '',
      '担当：mono.create 中村航汰',
    ]
  );

  return jsonResponse({ success: true });
}

function listFeedbacks() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('feedbacks');
  if (!sheet) return jsonResponse({ data: [] });
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var items = [];
    try { items = JSON.parse(r[4]); } catch(e) {}
    data.push({
      row:          i + 1,
      date:         r[0] || '',
      client_name:  r[1] || '',
      email:        r[2] || '',
      delivery_url: r[3] || '',
      items:        items,
      round:        r[5] || '1',
      status:       r[6] || '未対応'
    });
  }
  data.sort(function(a,b){ return b.date > a.date ? 1 : -1; });
  return jsonResponse({ data: data });
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

// ══════════════════════════════════════════════════════════════
// ── クライアントマスタ ────────────────────────────────────────
// シート: client_master
// 列: [row, name, email, plan, amount, pay_type, note, created_at]
// ══════════════════════════════════════════════════════════════
function getOrCreateClientMasterSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('client_master');
  if (!sh) {
    sh = ss.insertSheet('client_master');
    sh.appendRow(['name', 'email', 'plan', 'amount', 'pay_type', 'note', 'created_at']);
  }
  return sh;
}

function listClientMaster() {
  var sh = getOrCreateClientMasterSheet();
  var vals = sh.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0] && !r[1]) continue; // 空行スキップ
    data.push({
      row: i + 1,
      name: r[0] || '', email: r[1] || '', plan: r[2] || '',
      amount: r[3] || '', pay_type: r[4] || 'spot', note: r[5] || '',
      created_at: r[6] ? r[6].toString() : ''
    });
  }
  return jsonResponse({ data: data });
}

function saveClientMaster(d) {
  var sh = getOrCreateClientMasterSheet();
  var now = new Date().toISOString();
  if (d.row) {
    // 更新
    var rowNum = parseInt(d.row);
    sh.getRange(rowNum, 1, 1, 7).setValues([[
      d.name || '', d.email || '', d.plan || '',
      d.amount || '', d.pay_type || 'spot', d.note || '', now
    ]]);
  } else {
    // 追加
    sh.appendRow([d.name || '', d.email || '', d.plan || '',
      d.amount || '', d.pay_type || 'spot', d.note || '', now]);
  }
  return jsonResponse({ success: true });
}

function deleteClientMaster(rowNum) {
  var sh = getOrCreateClientMasterSheet();
  if (rowNum >= 2) sh.deleteRow(rowNum);
  return jsonResponse({ success: true });
}

// ══════════════════════════════════════════════════════════════
// ── プライベートリンク ────────────────────────────────────────
// シート: private_links
// 列: [token, client, plan, amount, pay_type, note, expires_at, views, created_at]
// ══════════════════════════════════════════════════════════════
function getOrCreatePrivateLinksSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('private_links');
  if (!sh) {
    sh = ss.insertSheet('private_links');
    sh.appendRow(['token', 'client', 'plan', 'amount', 'pay_type', 'note', 'expires_at', 'views', 'created_at', 'hearing_url']);
  }
  return sh;
}

function generateToken() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var t = 'mc_';
  for (var i = 0; i < 12; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

function createPrivateLink(d) {
  var sh = getOrCreatePrivateLinksSheet();
  var token = generateToken();
  var expireDays = parseInt(d.expire_days) || 30;
  var expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expireDays);
  sh.appendRow([
    token, d.client || '', d.plan || '', d.amount || '',
    d.pay_type || 'spot', d.note || '',
    expiresAt.toISOString(), 0, new Date().toISOString(), d.hearing_url || ''
  ]);
  return jsonResponse({ success: true, token: token });
}

function getPrivateLink(token) {
  if (!token) return jsonResponse({ error: 'no token' });
  var sh = getOrCreatePrivateLinksSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (r[0] === token) {
      // 期限チェック
      var exp = r[6] ? new Date(r[6]) : null;
      if (exp && exp < new Date()) return jsonResponse({ error: 'expired' });
      return jsonResponse({
        success: true,
        token: r[0], client: r[1], plan: r[2], amount: r[3],
        pay_type: r[4], note: r[5], expires_at: r[6] ? r[6].toString() : '',
        views: r[7] || 0, hearing_url: r[9] || ''
      });
    }
  }
  return jsonResponse({ error: 'not found' });
}

function listPrivateLinks() {
  var sh = getOrCreatePrivateLinksSheet();
  var vals = sh.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    var exp = r[6] ? new Date(r[6]) : null;
    data.push({
      row: i + 1, token: r[0], client: r[1], plan: r[2],
      amount: r[3], pay_type: r[4], note: r[5],
      expires_at: r[6] ? r[6].toString() : '', views: r[7] || 0,
      created_at: r[8] ? r[8].toString() : '', hearing_url: r[9] || '',
      expired: exp ? exp < new Date() : false
    });
  }
  return jsonResponse({ data: data.reverse() }); // 新しい順
}

function deletePrivateLink(token) {
  var sh = getOrCreatePrivateLinksSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] === token) { sh.deleteRow(i + 1); break; }
  }
  return jsonResponse({ success: true });
}

function recordPrivateLinkView(token) {
  if (!token) return jsonResponse({ error: 'no token' });
  var sh = getOrCreatePrivateLinksSheet();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] === token) {
      var views = (parseInt(vals[i][7]) || 0) + 1;
      sh.getRange(i + 1, 8).setValue(views);
      return jsonResponse({ success: true, views: views });
    }
  }
  return jsonResponse({ error: 'not found' });
}

// ══════════════════════════════════════════════════════════════
// ── 編集者契約書送付メール ────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function sendEditorContractMail(d) {
  var name         = d.name || '';
  var email        = d.email || '';
  var contractUrl  = d.contract_url || '';
  var driveFolder  = d.drive_folder || '';
  var note         = d.note || '';
  if (!email) return jsonResponse({ error: 'no email' });

  var body = '【mono.create】業務委託契約書のご送付\n\n'
    + name + ' 様\n\n'
    + 'この度は、mono.createへのご参加ありがとうございます。\n'
    + '業務委託契約書をお送りします。内容をご確認の上、ご署名・ご返信ください。\n\n'
    + '▼ 契約書\n' + contractUrl + '\n\n'
    + (note ? '▼ 追加事項\n' + note + '\n\n' : '')
    + '署名済みのPDFは、下記フォルダへご提出いただくか、メール添付でご返送ください。\n'
    + '▼ 提出先フォルダ\n' + driveFolder + '\n\n'
    + 'ご不明点はお気軽にご連絡ください。\n\n'
    + '───────────────\n'
    + 'mono.create\n'
    + '代表：中村 航汰\n'
    + 'E-mail: mono.create.group@gmail.com\n';

  MailApp.sendEmail({
    to: email,
    subject: '【mono.create】業務委託契約書のご送付',
    body: body,
    name: 'mono.create（中村 航汰）'
  });

  // 管理者にも通知
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: '【送付完了】' + name + ' 様へ契約書を送付しました',
    body: name + '（' + email + '）様へ契約書を送付しました。\n契約書: ' + contractUrl,
    name: 'mono.create LP'
  });

  return jsonResponse({ success: true });
}


// ================================================================
// ██████████████████████████████████████████████████████████████
//  電子契約システム（クラウドサイン方式）
// ██████████████████████████████████████████████████████████████
// ================================================================

var CONTRACT_SIG_SHEET = 'contract_signatures';

// ── シート取得 / 初期化 ────────────────────────────────────────
function getContractSigSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(CONTRACT_SIG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONTRACT_SIG_SHEET);
    sh.getRange(1, 1, 1, 10).setValues([[
      'token', 'type', 'name', 'email',
      'created_at', 'expires_at', 'status',
      'signed_at', 'signed_name', 'user_agent'
    ]]);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1E40AF').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── トークン生成（採用決定時に呼ぶ） ──────────────────────────
function createContractToken(type, name, email) {
  var token   = Utilities.getUuid();
  var now     = new Date();
  var expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30日間有効
  var sh = getContractSigSheet();
  sh.appendRow([
    token, type, name, email,
    now.toISOString(), expires.toISOString(),
    'pending', '', '', ''
  ]);
  var url = LP_BASE_URL + 'contract.html?t=' + token;
  return { token: token, url: url };
}

// ── トークンから契約書データ取得 ──────────────────────────────
function getContractByToken(token) {
  var sh   = getContractSigSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      var status  = data[i][6];
      var expires = new Date(data[i][5]);
      if (status !== 'signed' && new Date() > expires) {
        return jsonResponse({ error: 'expired' });
      }
      return jsonResponse({
        token:      data[i][0],
        type:       data[i][1],
        name:       data[i][2],
        email:      data[i][3],
        created_at: data[i][4],
        status:     status,
        signed_at:  data[i][7]
      });
    }
  }
  return jsonResponse({ error: 'not_found' });
}

// ── 署名記録 ──────────────────────────────────────────────────
function signContract(token, signedName, userAgent) {
  if (!token || !signedName) return jsonResponse({ error: 'missing_params' });

  var sh   = getContractSigSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      if (data[i][6] === 'signed') return jsonResponse({ error: 'already_signed' });

      var now  = new Date();
      var type = data[i][1];
      var name = data[i][2];
      var email = data[i][3];

      // シート更新
      sh.getRange(i + 1, 7).setValue('signed');
      sh.getRange(i + 1, 8).setValue(now.toISOString());
      sh.getRange(i + 1, 9).setValue(signedName);
      sh.getRange(i + 1, 10).setValue(userAgent || '');

      // 確認メール送信（両者）
      var emailError = '';
      try {
        sendContractSignedEmails(type, name, email, signedName, now);
      } catch(e) {
        emailError = e.toString();
        Logger.log('sendContractSignedEmails error: ' + emailError);
      }

      return jsonResponse({ success: true, email_error: emailError });
    }
  }
  return jsonResponse({ error: 'not_found' });
}

// ── 署名完了メール送信 ─────────────────────────────────────────
function sendContractSignedEmails(type, name, email, signedName, signedAt) {
  var typeLabel = type === 'sales' ? '営業スタッフ' : '動画編集者';
  var dateStr   = Utilities.formatDate(signedAt, 'Asia/Tokyo', 'yyyy年MM月dd日 HH:mm');

  // 応募者へ
  var bodyToApplicant = [
    name + ' 様',
    '',
    'この度はmono.createの業務委託契約書にご署名いただきありがとうございます。',
    '電子署名が正式に記録されました。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '【署名記録】',
    '━━━━━━━━━━━━━━━━━━━━',
    '契約種別  ：' + typeLabel + ' 業務委託契約書',
    '署名者    ：' + signedName + ' 様',
    '署名日時  ：' + dateStr,
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '引き続きよろしくお願いいたします。',
    '',
    '担当：mono.create 運営 中村航汰',
  ].join('\n');

  MailApp.sendEmail({
    to: email,
    subject: '【mono.create】業務委託契約書の署名完了のご確認',
    body: bodyToApplicant,
    name: 'mono.create（中村 航汰）'
  });

  // 管理者へ
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: '【署名完了】' + name + ' 様が契約書に署名しました',
    body: [
      '署名完了通知',
      '',
      '契約種別: ' + typeLabel,
      '署名者  : ' + name + ' (' + email + ')',
      '署名日時: ' + dateStr,
    ].join('\n'),
    name: 'mono.create 電子契約システム'
  });
}

// ── 署名メールテスト（GETアクション test_contract_email）────────
// GET: ?action=test_contract_email&key=ADMIN_KEY&token=TOKEN
// 指定トークンの署名完了メールを再送する（テスト用）
function testContractEmail(token) {
  var sh   = getContractSigSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      var type      = data[i][1];
      var name      = data[i][2];
      var email     = data[i][3];
      var signedName = data[i][8] || name;
      var now       = data[i][7] ? new Date(data[i][7]) : new Date();
      try {
        sendContractSignedEmails(type, name, email, signedName, now);
        return jsonResponse({ success: true, sent_to: email });
      } catch(e) {
        return jsonResponse({ error: e.toString() });
      }
    }
  }
  return jsonResponse({ error: 'not_found' });
}

// ── 採用決定フック（既存の採用フローから呼ぶ） ─────────────────
// type: 'sales' or 'editor'
// return: 契約書署名URL (string)
function issueContractUrl(type, name, email) {
  try {
    var result = createContractToken(type, name, email);
    return result.url;
  } catch(e) {
    Logger.log('issueContractUrl error: ' + e);
    return LP_BASE_URL + 'contract.html';
  }
}

// ================================================================
// ██████████████████████████████████████████████████████████████
//  請求書システム
// ██████████████████████████████████████████████████████████████
// ================================================================

var INVOICE_SHEET      = 'invoices';
var INVOICE_FOLDER_NAME = 'mono.create 請求書';

// ── invoicesシート取得/初期化 ──────────────────────────────────
function getInvoiceSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(INVOICE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(INVOICE_SHEET);
    sh.appendRow(['請求書番号','クライアント名','金額','発行日','支払期日','ステータス','送付先メール','作成日時','Drive URL','備考']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');
  }
  return sh;
}

// ── Drive 請求書フォルダ取得/作成 ─────────────────────────────
function getInvoiceFolder() {
  var folders = DriveApp.getFoldersByName(INVOICE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(INVOICE_FOLDER_NAME);
}

// ── 請求書送付（メール送信 + シート保存 + Drive保存） ─────────
function sendInvoice(data) {
  var invNum    = data.inv_num    || '';
  var client    = data.client     || '';
  var total     = data.total      || '¥0';
  var issueDate = data.issue_date || '';
  var due       = data.due        || '';
  var note      = data.note       || '';
  var htmlBody  = data.html_body  || '';
  var to        = data.to         || '';

  if (!to) return jsonResponse({ error: 'email_required' });
  if (!invNum) return jsonResponse({ error: 'inv_num_required' });

  // 1. Drive に HTML として保存（ブラウザから印刷→PDFが可能）
  var driveUrl = '';
  try {
    var folder   = getInvoiceFolder();
    var filename = '請求書_' + invNum + '_' + client + '.html';
    var blob     = Utilities.newBlob(htmlBody, 'text/html', filename);
    var file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    driveUrl = file.getUrl();
  } catch(e) {
    Logger.log('Invoice Drive save error: ' + e);
  }

  // 2. シートに記録
  try {
    var sh  = getInvoiceSheet();
    var now = new Date();
    sh.appendRow([invNum, client, total, issueDate, due, '未払い', to, now.toISOString(), driveUrl, note]);
  } catch(e) {
    Logger.log('Invoice sheet save error: ' + e);
  }

  // 3. メール送信
  MailApp.sendEmail({
    to:       to,
    subject:  '【mono.create】請求書のご送付（' + invNum + '）',
    body:     client + ' 御中\n\nお世話になっております。mono.create 中村航汰です。\n\n請求書をお送りいたします。\nご確認のほど、よろしくお願いいたします。\n\n━━━━━━━━━━━━━━━━━━━━\n請求書番号: ' + invNum + '\n請求金額　: ' + total + '\n支払期限　: ' + due + '\n━━━━━━━━━━━━━━━━━━━━\n\nmono.create 中村航汰\nmono.create.group@gmail.com',
    htmlBody: htmlBody,
    name:     'mono.create（中村 航汰）'
  });

  return jsonResponse({ success: true, drive_url: driveUrl });
}

// ── 請求書一覧取得 ────────────────────────────────────────────
function listInvoices() {
  var sh   = getInvoiceSheet();
  var data = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // 空行スキップ
    rows.push({
      inv_num:    data[i][0],
      client:     data[i][1],
      total:      data[i][2],
      issue_date: data[i][3],
      due:        data[i][4],
      status:     data[i][5],
      email:      data[i][6],
      created_at: data[i][7],
      drive_url:  data[i][8],
      note:       data[i][9],
      row_index:  i + 1
    });
  }
  rows.reverse(); // 新しい順
  return jsonResponse({ invoices: rows });
}

// ── 請求書ステータス更新 ──────────────────────────────────────
function updateInvoiceStatus(invNum, status) {
  var sh   = getInvoiceSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(invNum)) {
      sh.getRange(i + 1, 6).setValue(status);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ error: 'not_found' });
}

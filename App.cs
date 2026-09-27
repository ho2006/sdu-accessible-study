using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class StudyApp : Form
{
    private readonly WebView2 browser = new WebView2();
    private readonly Button pause = new Button();
    private readonly Label status = new Label();
    private readonly System.Windows.Forms.Timer heartbeat = new System.Windows.Forms.Timer();
    private bool paused;
    private bool ready;
    private const string Home = "https://sysaq.sdu.edu.cn/lab-study-front/person";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--check-runtime")
        {
            try { return String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()) ? 2 : 0; }
            catch { return 2; }
        }
        bool first;
        using (var mutex = new Mutex(true, "Local\\SDUAccessibleStudy", out first))
        {
            if (!first)
            {
                MessageBox.Show("ѧϰӦ���Ѿ����С����л����Ѵ򿪵Ĵ��ڡ�", "ɽ��ѧϰ����");
                return 1;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new StudyApp());
        }
        return 0;
    }

    private StudyApp()
    {
        Text = "ɽ��ѧϰ���� �� �Զ��γ̵���";
        Width = 1280;
        Height = 900;
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Microsoft YaHei UI", 10);
        KeyPreview = true;

        var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, Padding = new Padding(8), WrapContents = false };
        pause.Text = "��ͣ��F8��";
        pause.AutoSize = true;
        pause.AccessibleName = "��ͣ������Զ��γ̵���";
        pause.Click += delegate { TogglePause(); };
        var home = new Button { Text = "��������", AutoSize = true, AccessibleName = "���ظ������Ĳ���ͣ" };
        home.Click += delegate {
            if (!ready) return;
            paused = true;
            UpdatePauseLabel();
            browser.CoreWebView2.Navigate(Home);
        };
        var note = new Label { Text = "ÿҳ���� 2 �� 10 �� �� �������Ķ� �� F8 ��ͣ/����", AutoSize = true, Margin = new Padding(12, 8, 0, 0) };
        toolbar.Controls.Add(pause);
        toolbar.Controls.Add(home);
        toolbar.Controls.Add(note);
        status.Dock = DockStyle.Bottom;
        status.Height = 62;
        status.Padding = new Padding(12, 8, 12, 4);
        status.Text = "�������������������";
        status.AccessibleName = "�Զ�����״̬";
        browser.Dock = DockStyle.Fill;
        browser.AccessibleName = "ѧУѧϰƽ̨";
        Controls.Add(browser);
        Controls.Add(toolbar);
        Controls.Add(status);

        KeyDown += delegate(object sender, KeyEventArgs e) {
            if (e.KeyCode == Keys.F8) { TogglePause(); e.Handled = true; }
        };
        heartbeat.Interval = 500;
        heartbeat.Tick += delegate { SendState(); };
        FormClosed += delegate { heartbeat.Dispose(); browser.Dispose(); };
        Shown += async delegate {
            try
            {
                browser.CreationProperties = new CoreWebView2CreationProperties {
                    UserDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SDUAccessibleStudy", "WebView"),
                    IsInPrivateModeEnabled = true,
                    Language = "zh-CN"
                };
                await browser.EnsureCoreWebView2Async();
                var core = browser.CoreWebView2;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsStatusBarEnabled = true;
                core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e) {
                    if (!SchoolUrl(e.Uri)) {
                        e.Cancel = true;
                        paused = true;
                        UpdatePauseLabel();
                        status.Text = "��ֹͣ��ѧУ HTTPS ҳ����ת��������ͨ�������ʵĿ���ַ��";
                    }
                };
                core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e) {
                    e.Handled = true;
                    if (SchoolUrl(e.Uri)) core.Navigate(e.Uri);
                    else status.Text = "�ⲿҳ��δ�򿪡���֧��ѧУ HTTPS ��¼��ѧϰҳ�档";
                };
                core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e) {
                    e.State = CoreWebView2PermissionState.Deny;
                };
                core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e) {
                    Uri source;
                    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.Host != "sysaq.sdu.edu.cn" || source.Scheme != "https") return;
                    try {
                        string value = e.TryGetWebMessageAsString();
                        if (value.StartsWith("STATUS:")) status.Text = value.Substring(7, Math.Min(300, value.Length - 7));
                        if (value == "PAUSE") { paused = true; UpdatePauseLabel(); }
                    } catch (ArgumentException) { }
                };
                core.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs e) {
                    if (!e.IsSuccess) status.Text = "ҳ��δ���سɹ���" + e.WebErrorStatus + "������У԰��/VPN������ Ctrl+R ���ԡ�";
                    SendState();
                };
                core.ProcessFailed += delegate {
                    paused = true;
                    UpdatePauseLabel();
                    status.Text = "����������쳣���Զ�������ֹͣ����رղ����´�Ӧ�á�";
                };
                browser.KeyDown += delegate(object s, KeyEventArgs e) {
                    if (e.KeyCode == Keys.F8) { e.Handled = true; TogglePause(); }
                };
                string script;
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("reader.js"))
                using (var reader = new StreamReader(stream)) script = reader.ReadToEnd();
                await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
                ready = true;
                heartbeat.Start();
                core.Navigate(Home);
                status.Text = "����ѧУҳ���¼����¼���Զ�ʶ��γ̣����롢��֤��Ϳ����ɱ�����ɡ�";
            }
            catch (Exception error)
            {
                status.Text = "����ʧ�ܣ�" + error.GetType().Name;
                MessageBox.Show("�޷����������������\n\n��ȷ���Ѱ�װ Microsoft Edge WebView2 Runtime��������ѹ�����ڵ� DLL �ļ���\n\n�ٷ���װ��ַ��https://developer.microsoft.com/microsoft-edge/webview2/\n\n����" + error.Message,
                    "����ʧ��", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
    }

    private static bool SchoolUrl(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "https" &&
            (uri.Host == "sdu.edu.cn" || uri.Host.EndsWith(".sdu.edu.cn", StringComparison.OrdinalIgnoreCase));
    }

    private void TogglePause() { paused = !paused; UpdatePauseLabel(); SendState(); }
    private void UpdatePauseLabel() { pause.Text = paused ? "������F8��" : "��ͣ��F8��"; }
    private void SendState()
    {
        if (!ready || IsDisposed || browser.CoreWebView2 == null) return;
        bool active = Form.ActiveForm == this && WindowState != FormWindowState.Minimized;
        try {
            browser.CoreWebView2.PostWebMessageAsJson("{\"paused\":" + (paused ? "true" : "false") + ",\"active\":" + (active ? "true" : "false") + "}");
        } catch (InvalidOperationException) { }
    }
}

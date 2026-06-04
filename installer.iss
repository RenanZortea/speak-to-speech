; Inno Setup script for SpeakToSpeech.
; Driven by build.ps1 (which passes /DMyAppVersion). Compile manually with:
;   "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" /DMyAppVersion=0.2.0 installer.iss
;
; Per-user install (no admin/UAC). Installs the PyInstaller onedir output from
; dist\SpeakToSpeech\ into %LOCALAPPDATA%\Programs\SpeakToSpeech.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "SpeakToSpeech"
#define MyAppPublisher "Renan Zortea"
#define MyAppURL "https://github.com/RenanZortea/speak-to-speech"
#define MyAppExeName "SpeakToSpeech.exe"

[Setup]
AppId={{8F3C5A21-7B4E-4D9A-9C2E-SPEAK2SPEECH01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Per-user — no elevation needed (matches our ~/SpeakToSpeech + HF cache writes).
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=SpeakToSpeech-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Icon for the Setup.exe itself and the wizard.
SetupIconFile=docs\icon.ico
; Required so updates can replace files while the app is (briefly) running.
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The entire PyInstaller onedir bundle.
Source: "dist\SpeakToSpeech\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

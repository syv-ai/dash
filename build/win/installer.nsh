; Dash NSIS installer customizations

!include "nsDialogs.nsh"

Caption "${PRODUCT_NAME} ${VERSION} Setup"

!ifndef BUILD_UNINSTALLER
  ; Repurpose the SHOWREADME slot as a "Create Desktop Shortcut" checkbox
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create Desktop Shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"

  Function CreateDesktopShortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  FunctionEnd

  ; Add a decorative checkbox + disclaimer to MUI2's finish page. MUI2 builds
  ; the page with nsDialogs and exposes $mui.FinishPage as the parent dialog,
  ; so we attach extra controls in the SHOW callback.
  Function FinishPageShow
    ${NSD_CreateLabel} 120u 145u 195u 10u "PS. We don't know how to use Windows"
    Pop $1
    SetCtlColors $1 "808080" "transparent"

    ${NSD_CreateCheckbox} 120u 125u 195u 12u "Happy coding!"
    Pop $0
    ${NSD_Check} $0
  FunctionEnd
!endif

; customFinishPage must be defined at top level (outside !ifndef BUILD_UNINSTALLER)
; so assistedInstaller.nsh's !ifmacrodef detects it. The macro body expands at
; the point MUI_PAGE_FINISH would normally be inserted, so LogicLib is available.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend

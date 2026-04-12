@echo off
:: Nexus 一键安装脚本（Windows）
:: macOS / Linux 用户请改用：
::     npm install && npm run build && npm run electron:dev
:: 或从 GitHub Releases 下载对应平台的安装包

chcp 65001 >nul
title Nexus 一键安装

echo ============================================
echo   Nexus 一键安装脚本（Windows）
echo ============================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js ^(https://nodejs.org^)
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo [信息] Node.js 版本: %%i

:: 第1步：安装依赖
echo.
echo [1/4] 安装 npm 依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] npm install 失败
    pause
    exit /b 1
)
echo [完成] 依赖安装成功

:: 第2步：构建项目
echo.
echo [2/4] 构建项目...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    pause
    exit /b 1
)
echo [完成] 构建成功

:: 第3步：下载语音模型
echo.
echo [3/4] 检查语音模型...

if not exist "sherpa-models" mkdir sherpa-models

set ASR_DIR=sherpa-models\sherpa-onnx-streaming-paraformer-bilingual-zh-en
if exist "%ASR_DIR%\encoder.int8.onnx" (
    echo [跳过] ASR 模型已存在
) else (
    echo [下载] 正在下载 ASR 模型（约1.1GB，请耐心等待）...
    where git >nul 2>nul
    if %errorlevel% neq 0 (
        echo [警告] 未检测到 git，无法自动下载模型
        echo [提示] 请手动下载: https://github.com/k2-fsa/sherpa-onnx/releases
        echo         将 sherpa-onnx-streaming-paraformer-bilingual-zh-en 放到 sherpa-models 目录
        goto :skip_asr
    )
    git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en "%ASR_DIR%"
    if %errorlevel% neq 0 (
        echo [警告] 从 HuggingFace 下载失败，尝试备用地址...
        git clone --depth 1 https://www.modelscope.cn/models/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en "%ASR_DIR%"
    )
    if %errorlevel% neq 0 (
        echo [警告] 模型下载失败，语音识别功能将不可用
        echo [提示] 可稍后手动下载模型到 sherpa-models 目录
    ) else (
        echo [完成] ASR 模型下载成功
    )
)
:skip_asr

:: 第4步：下载唤醒词模型
echo.
echo [4/4] 检查唤醒词模型...

set KWS_DIR=sherpa-models\sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01
if exist "%KWS_DIR%\encoder-epoch-12-avg-2-chunk-16-left-64.onnx" (
    echo [跳过] KWS 唤醒词模型已存在
) else (
    echo [下载] 正在下载唤醒词模型（约15MB）...
    where git >nul 2>nul
    if %errorlevel% neq 0 (
        echo [警告] 未检测到 git，无法自动下载唤醒词模型
        echo [提示] 请手动下载: https://github.com/k2-fsa/sherpa-onnx/releases
        goto :skip_kws
    )
    git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01 "%KWS_DIR%"
    if %errorlevel% neq 0 (
        echo [警告] 唤醒词模型下载失败，免提唤醒功能将不可用
    ) else (
        echo [完成] KWS 唤醒词模型下载成功
    )
)
:skip_kws
set KWS_ZH_DIR=sherpa-models\sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01
if exist "%KWS_ZH_DIR%\encoder-epoch-99-avg-1-chunk-16-left-64.onnx" (
    echo [提示] 中文 KWS 模型已存在
) else (
    echo [下载] 正在下载中文 KWS 模型（约 32MB）...
    where git >nul 2>nul
    if %errorlevel% neq 0 (
        echo [警告] 未检测到 git，无法自动下载中文 KWS 模型
        echo [提示] 请手动下载 https://github.com/k2-fsa/sherpa-onnx/releases
        goto :after_zh_kws
    )
    git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01 "%KWS_ZH_DIR%"
    if %errorlevel% neq 0 (
        echo [警告] 中文 KWS 模型下载失败
    ) else (
        echo [完成] 中文 KWS 模型下载成功
    )
)
:after_zh_kws

echo.
echo ============================================
echo   安装完成！
echo ============================================
echo.
echo   启动开发模式:    npm run electron:dev
echo   打包 Windows:    npm run package:win
echo   打包 macOS:      npm run package:mac
echo   打包 Linux:      npm run package:linux
echo.
pause

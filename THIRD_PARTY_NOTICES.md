# Third-Party Notices

## Live2D sample characters

Nexus bundles the Live2D original sample characters Mao, Haru, and Hiyori
Momose for avatar rendering and Cubism SDK integration.

> This content uses sample data owned and copyrighted by Live2D Inc. The
> sample data are utilized in accordance with terms and conditions set by
> Live2D Inc. This content itself is created at the author's sole discretion.

The model data remains copyrighted by Live2D Inc. Use and redistribution are
subject to both documents below and are not granted by the Nexus MIT license:

- Live2D Free Material License Agreement:
  https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
- Terms of Use for Live2D Cubism Sample Data:
  https://www.live2d.com/en/learn/sample/model-terms/

Original sources:

- https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Mao
- https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Haru
- https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources/Hiyori

The Haru runtime manifest included with Nexus removes references to the sample
voice files; those voice files are not bundled or used.

## Typing awareness

Global typing detection uses [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi)
1.5.x (MIT). The package vendors [libuiohook](https://github.com/kwhat/libuiohook),
which is LGPL-3.0-or-later. Nexus loads the N-API prebuild and does not
statically relink it. The hook is optional: if the binary is missing or the
operating system denies input monitoring, the rest of the app keeps running.
Nexus never records or forwards which keys were pressed.

## Smart Turn v3 end-of-turn model

End-of-turn audio inference uses the [Smart Turn v3](https://huggingface.co/pipecat-ai/smart-turn-v3)
model (`smart-turn-v3.2-cpu.onnx`, int8, ~8 MB) from Pipecat / Daily.

- Source: https://github.com/pipecat-ai/smart-turn
- Weights: https://huggingface.co/pipecat-ai/smart-turn-v3
- License: BSD 2-Clause. Copyright (c) 2024–2025, Daily.

The license file in the upstream repository is reproduced below. The model is
downloaded on demand into the user's model directory and is not part of the
Nexus source or installer:

```
BSD 2-Clause License

Copyright (c) 2024–2025, Daily

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The Whisper-Tiny log-mel front end follows the reference preprocessing in
`inference.py` (`WhisperFeatureExtractor(chunk_length=8)`, `do_normalize=True`,
last 8 seconds, zero-padded at the front). The JavaScript port lives in
`shared/smartTurnFeatures.js`.

## ONNX Runtime Web

The Smart Turn runner uses [`onnxruntime-web`](https://github.com/microsoft/onnxruntime)
1.24.x (MIT). Nexus ships the Node API entry and wasm glue under
`resources/smart-turn-ort/` and reads the wasm binary from the browser VAD's
existing `dist/vendor/ort/` copy.

Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT
License: https://github.com/microsoft/onnxruntime/blob/main/LICENSE

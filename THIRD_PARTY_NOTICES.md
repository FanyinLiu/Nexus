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

# Patinete APP — dashboard BLE (React Native + Expo Dev Build)

Substitui a antiga dashboard web do **Patinete ESP**: conecta por **Bluetooth
Low Energy** ao firmware (que agora roda NimBLE em vez de WiFi), mostra a
telemetria ao vivo e controla todos os parâmetros.

## Telas

- **Painel**: velocidade grande, bateria com %, barra de potência estilo
  carro elétrico (consumo → direita, regeneração → esquerda), corrente,
  temperatura, modo, estado, faltas, LIGAR/DESLIGAR e ⛔ E-STOP.
- **Configurações**: modo torque/velocidade, limites (corrente, velocidade,
  tensão) com ajuste ao vivo, ângulo zero FOC (±30° e ajuste fino),
  diagnóstico (gap do loop, faltas) e limpar faltas.

Com o **painel físico (Nano)** ativo, o acelerador/freio são dele; o app
mostra "PAINEL FÍSICO" e segue mandando em enable, e-stop, limites e modo.

## Como compilar para iOS (Development Build — BLE exige build nativo)

Pré-requisitos: macOS com **Xcode** instalado (App Store) + CocoaPods
(`brew install cocoapods`) + Node 18+.

> ⚠️ **iPhone FÍSICO obrigatório**: o simulador do iOS não tem Bluetooth.
> O Expo Go também **não funciona** (react-native-ble-plx é código nativo).

```bash
cd PatineteApp
npm install
npx expo install --fix          # alinha as versões nativas com o SDK
npx expo prebuild               # gera a pasta ios/
npx expo run:ios --device       # compila e instala no iPhone plugado
```

**Assinatura (primeira vez):** o build vai pedir um time de assinatura.
Abra `ios/Patinete.xcworkspace` no Xcode → target *Patinete* → *Signing &
Capabilities* → marque *Automatically manage signing* e selecione seu
Apple ID como Team (funciona com conta gratuita). No iPhone: Ajustes →
Geral → *VPN e Gerenciamento de Dispositivo* → confiar no desenvolvedor.

> Conta Apple **gratuita**: o app expira em 7 dias — é só rodar
> `npx expo run:ios --device` de novo para reinstalar. Com a conta paga
> (US$ 99/ano) vale 1 ano.

Depois do primeiro build, o dia a dia é só `npm start` (abre no dev client
instalado no iPhone, com hot reload das telas).

## Permissões

Já declaradas no `app.json` (BLUETOOTH_SCAN/CONNECT + localização no Android;
NSBluetoothAlwaysUsageDescription no iOS). O app pede em tempo de execução na
primeira abertura.

## Protocolo (espelho do firmware — `include/ble_dashboard.h` no Patinete ESP)

- Dispositivo: **PatineteESP** · Serviço `7a0b1000-…0001`
- Telemetria: notify de 26 bytes a 10 Hz (característica `…1001`)
- Controle: write `[id u8][valor float32 LE]` (característica `…1002`)

Qualquer mudança no protocolo deve ser feita nos DOIS lados juntos.

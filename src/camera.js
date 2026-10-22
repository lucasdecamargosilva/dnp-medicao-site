export async function startCamera(videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },   // mais pixels = pupila e borda do cartão mais precisas
      audio: false,
    });
  } catch (err) {
    throw new Error('Não consegui acessar a webcam. Permita o acesso à câmera.');
  }
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });
  return stream;
}

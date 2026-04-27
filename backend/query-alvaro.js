import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(fs.readFileSync("./firebase-service-account.json", "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount)
});

const adminDb = getFirestore(app);

async function run() {
  const usersRef = adminDb.collection('users');
  const snapshot = await usersRef.get();
  let alvaroId = null;
  
  snapshot.forEach(doc => {
    const data = doc.data();
    if (JSON.stringify(data).toLowerCase().includes('alvaro')) {
      alvaroId = doc.id;
      console.log('Found Alvaro UID:', alvaroId, data.email, data.fullName);
    }
  });

  if (alvaroId) {
    const simcarClipsRef = adminDb.collection('users').doc(alvaroId).collection('simcar_clips');
    const clips = await simcarClipsRef.get();
    clips.forEach(doc => {
        const data = doc.data();
        console.log('--- Clip ID:', doc.id, '---');
        console.log(JSON.stringify(data.analysisImages || data.auasImages || [], null, 2));
    });
  }
}
run().catch(console.error);

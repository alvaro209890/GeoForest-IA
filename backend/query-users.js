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
  console.log(`Found ${snapshot.size} users.`);
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(doc.id, data.email, data.fullName, data.name);
  });
}
run().catch(console.error);

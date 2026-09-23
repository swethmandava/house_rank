import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyB6KA4ha2CkZrbfEcqHHGFPwCjLFAv8MQU',
  authDomain: 'dhama-3905d.firebaseapp.com',
  projectId: 'dhama-3905d',
  storageBucket: 'dhama-3905d.firebasestorage.app',
  messagingSenderId: '824713803110',
  appId: '1:824713803110:web:57e8a099d54bdd9cc1c4a7',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);

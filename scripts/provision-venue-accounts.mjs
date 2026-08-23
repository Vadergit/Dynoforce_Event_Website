import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCPSI670w5BFJcts_7uHDR87zbsFwFdiI0",
  authDomain: "dynoforce.firebaseapp.com",
  projectId: "dynoforce",
  storageBucket: "dynoforce.firebasestorage.app",
  messagingSenderId: "609566770862",
  appId: "1:609566770862:web:8e833f77dbdb95c611cf3f",
};

const assetUrl = (slug, file) => `https://event.dynoforce.ch/branding/${slug}/${file}`;

const venues = [
  {
    username: "bouba",
    slug: "bouba-baden",
    displayName: "BOUBA Boulder Baden",
    primaryColor: "#345F6B",
    eventLogo: "eventlogo-df-1000x1000.png",
    headerBanner: "header-banner-2400x600.jpg",
    sponsorBanner: "sponsor-footer-2500x500.jpg",
  },
  {
    username: "boulderlounge",
    slug: "boulderlounge-schlieren",
    displayName: "BoulderLounge Schlieren",
    primaryColor: "#071F78",
    eventLogo: "eventlogo-1000x1000.png",
    venueLogo: "hallenlogo-1000x1000.png",
    headerBanner: "header-banner-logo-left-2400x600.jpg",
    sponsorBanner: "sponsor-banner-2500x500.jpg",
  },
  {
    username: "grindelboulder",
    slug: "grindelboulder-bassersdorf",
    displayName: "GrindelBoulder Bassersdorf",
    primaryColor: "#0ABE8F",
    eventLogo: "eventlogo-df-1000x1000.png",
    headerBanner: "header-banner-2400x600.jpg",
    sponsorBanner: "sponsor-footer-2500x500.jpg",
  },
  {
    username: "kraftreaktor",
    slug: "kraftreaktor-lenzburg-aarau",
    displayName: "Kraftreaktor Lenzburg/Aarau",
    primaryColor: "#1D1D1D",
    eventLogo: "eventlogo-df-1000x1000.png",
    headerBanner: "header-banner-2400x600.jpg",
    sponsorBanner: "sponsor-footer-2500x500.jpg",
  },
  {
    username: "minimum",
    slug: "minimum-zuerich",
    displayName: "Minimum Zürich",
    primaryColor: "#92B4B6",
    eventLogo: "eventlogo-df-1000x1000.png",
    headerBanner: "header-banner-2400x600.jpg",
    sponsorBanner: "sponsor-footer-2500x500.jpg",
  },
  {
    username: "mito",
    slug: "mito-zuerich",
    displayName: "MITO Bouldering Zürich",
    primaryColor: "#7D1413",
    eventLogo: "eventlogo-df-1000x1000.png",
    headerBanner: "header-banner-2400x600.jpg",
    sponsorBanner: "sponsor-footer-2500x500.jpg",
  },
];

function getPasswords() {
  let passwords;
  try {
    passwords = JSON.parse(process.env.DYNOFORCE_VENUE_PASSWORDS || "{}");
  } catch {
    throw new Error("DYNOFORCE_VENUE_PASSWORDS muss ein gültiges JSON-Objekt sein.");
  }

  const missing = venues.filter(({ username }) => !passwords[username]).map(({ username }) => username);
  if (missing.length) throw new Error(`Passwörter fehlen für: ${missing.join(", ")}`);
  return passwords;
}

function createBranding(venue) {
  return {
    eventLogo: assetUrl(venue.slug, venue.eventLogo),
    venueLogo: venue.venueLogo ? assetUrl(venue.slug, venue.venueLogo) : "",
    headerBanner: assetUrl(venue.slug, venue.headerBanner),
    sponsorBanner: assetUrl(venue.slug, venue.sponsorBanner),
    showVenueLogo: Boolean(venue.venueLogo),
    showHeaderBannerThumb: true,
    eventLogoScale: 100,
    venueLogoScale: 100,
    headerBannerScale: 100,
    headerBannerThumbScale: 100,
    sponsorBannerScale: 100,
    eventLogoAspect: "1 / 1",
    venueLogoAspect: "1 / 1",
    headerBannerAspect: "4 / 1",
    sponsorBannerAspect: "5 / 1",
    eventLogoPdfData: "",
    venueLogoPdfData: "",
    headerBannerPdfData: "",
    sponsorBannerPdfData: "",
    primaryColor: venue.primaryColor,
  };
}

async function provisionVenue(venue, password) {
  const app = initializeApp(firebaseConfig, `venue-${venue.username}-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const email = `${venue.username}@dynoforce.ch`;
  let credential;

  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error?.code !== "auth/email-already-in-use") throw error;
    credential = await signInWithEmailAndPassword(auth, email, password);
  }

  if (credential.user.displayName !== venue.displayName) {
    await updateProfile(credential.user, { displayName: venue.displayName });
  }

  await setDoc(
    doc(db, "brandingPresets", `venue-${venue.username}`),
    {
      name: venue.displayName,
      ownerUid: credential.user.uid,
      branding: createBranding(venue),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  await signOut(auth);
  await deleteApp(app);
  return { email, preset: venue.displayName };
}

const passwords = getPasswords();
for (const venue of venues) {
  const result = await provisionVenue(venue, passwords[venue.username]);
  console.log(`Eingerichtet: ${result.email} -> ${result.preset}`);
}

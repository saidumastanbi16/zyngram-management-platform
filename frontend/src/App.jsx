import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import EmployeeManagement from "./EmployeeManagement";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:5050" : "");
const MOBILE_RECHARGE_SERVICE_ID = "SERVICE-MOBILE-RECHARGE";
const locationIcon = L.divIcon({
  className: "zyngram-map-marker",
  html: "<span></span>",
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

async function api(path, options = {}) {
  const token = localStorage.getItem("zyngram_token");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const responseText = await res.text();
  let data = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      throw new Error("The server returned an invalid response");
    }
  }
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data;
}

const money = n => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const dateText = v => v ? new Date(v).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" }) : "—";
const isBookableLocation = location => location?.mapping?.mapped === true &&
  Number.isFinite(Number(location.accuracy)) &&
  Number(location.accuracy) > 0 &&
  Number(location.accuracy) <= 100;

function App() {
  const [authView, setAuthView] = useState("landing");
  const [authChecking, setAuthChecking] = useState(() => Boolean(localStorage.getItem("zyngram_token")));
  const [page, setPage] = useState("Dashboard");
  const [session, setSession] = useState(null);
  const [users, setUsers] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [apiStatus, setApiStatus] = useState("Checking API...");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const calls = await Promise.allSettled([
      api("/api/users"),
      api("/api/franchises"),
      api("/api/geo-boundaries"),
      api("/api/orders"),
      api(["ADMIN", "HQ"].includes(session?.role) ? "/api/commissions" : `/api/commissions/${session?.id || ""}`),
      api("/api/audit-logs"),
      api("/api/dashboard"),
    ]);
    const [u, f, b, o, c, a, d] = calls;
    if (u.status === "fulfilled") setUsers(u.value.users || []);
    if (f.status === "fulfilled") setFranchises(f.value.franchises || []);
    if (b.status === "fulfilled") setBoundaries(b.value.boundaries || []);
    if (o.status === "fulfilled") setOrders(o.value.orders || []);
    if (c.status === "fulfilled") setCommissions(c.value.commissions || c.value.ledger || c.value.entries || []);
    if (a.status === "fulfilled") setAuditLogs(a.value.logs || a.value.auditLogs || a.value.audit_logs || []);
    if (d.status === "fulfilled") setDashboardData(d.value);
    setApiStatus(calls.some(x => x.status === "fulfilled") ? "API Connected" : "API Connection Error");
    setLoading(false);
  }, [session]);

  useEffect(() => {
    const token = localStorage.getItem("zyngram_token");
    if (!token) {
      localStorage.removeItem("zyngram_session");
      return undefined;
    }

    let active = true;
    api("/api/auth/me")
      .then(data => {
        if (active) setSession(data.user);
      })
      .catch(() => {
        localStorage.removeItem("zyngram_token");
        localStorage.removeItem("zyngram_session");
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!["ADMIN", "HQ", "COMMAND", "HUB", "CENTER"].includes(session?.role)) return undefined;
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, [session, load]);

  
  const hierarchy = useMemo(() => {
    const point = franchises.find(x => x.level === "Point" && x.status === "ACTIVE");
    const center = franchises.find(x => x.id === point?.parent_id && x.level === "Center" && x.status === "ACTIVE");
    const hub = franchises.find(x => x.id === center?.parent_id && x.level === "Hub" && x.status === "ACTIVE");
    const command = franchises.find(x => x.id === hub?.parent_id && x.level === "Command" && x.status === "ACTIVE");
    return { command, hub, center, point };
  }, [franchises]);

  const finishLogin = (data, welcomeMessage = "Welcome back") => {
    localStorage.setItem("zyngram_token", data.token);
    localStorage.setItem("zyngram_session", JSON.stringify(data.user));
    setUsers([]);
    setFranchises([]);
    setBoundaries([]);
    setOrders([]);
    setCommissions([]);
    setAuditLogs([]);
    setDashboardData(null);
    setPage("Dashboard");
    setSession(data.user);
    setAuthView("landing");
    notify(welcomeMessage);
  };

  const login = async credentials => {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials)
    });
    finishLogin(data);
  };

  const register = async account => {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(account)
    });
    finishLogin(data, "Account created. Welcome to Zyngram!");
  };

  if (authChecking) {
    return <div className="auth-loading"><img className="brand-logo" src="/zyngram-logo.png" alt="Zyngram" /><p>Securely checking your session…</p></div>;
  }

  if (!session) {
    if (authView === "register") {
      return <Registration onBack={() => setAuthView("landing")} onCustomerLogin={() => setAuthView("customer-login")} onRegister={register}/>;
    }
    if (authView === "admin-login" || authView === "customer-login") {
      return <Login
        key={authView}
        adminMode={authView === "admin-login"}
        onBack={() => setAuthView("landing")}
        onRegister={() => setAuthView("register")}
        onLogin={login}
      />;
    }
    return <Landing
      onRegister={() => setAuthView("register")}
      onAdminLogin={() => setAuthView("admin-login")}
      onCustomerLogin={() => setAuthView("customer-login")}
    />;
  }

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (error) {
      notify(`Signed out locally; server session could not be cleared: ${error.message}`, "warning");
    }
    localStorage.removeItem("zyngram_token");
    localStorage.removeItem("zyngram_session");
    setUsers([]);
    setFranchises([]);
    setBoundaries([]);
    setOrders([]);
    setCommissions([]);
    setAuditLogs([]);
    setDashboardData(null);
    setSession(null);
    setAuthView("landing");
  };

  const isStaff = ["ADMIN", "HQ", "COMMAND", "HUB", "CENTER"].includes(session.role);
  const isEmployee = session.role === "EMPLOYEE";
  const isAdmin = session.role === "ADMIN";
  const nav = isStaff
    ? isAdmin
      ? ["Dashboard", "Customers", "Locations", "Franchises", "Orders", "Mobile Recharge", "Attribution", "Commissions", "Wallet", "Employees", "Reports", "Audit Logs", "Staff Access"]
      : session.role === "HQ"
        ? ["Dashboard", "Customers", "Franchises", "Orders", "Mobile Recharge", "Attribution", "Commissions", "Wallet", "Reports"]
        : ["Dashboard", "Customers", "Orders", "Mobile Recharge", "Attribution", "Commissions", "Wallet", "Employees", "Reports"]
    : isEmployee ? ["Employee Center"] : ["My account"];

  return (
    <div className="app">
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
      <aside className="sidebar">
        <div className="brand"><img className="brand-logo" src="/zyngram-logo.png" alt="" /><div><h2>Zyngram</h2><span>Franchise System</span></div></div>
        <nav>{nav.map(x => <button key={x} className={page === x ? "nav-item active" : "nav-item"} onClick={() => setPage(x)}>{x}</button>)}</nav>
        <div className="sidebar-bottom"><i className="status-dot"/>{apiStatus}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{isStaff ? page : "My Zyngram"}</h1><p>{isStaff ? "Complete Franchise Management System" : "Your account and service locations"}</p></div>
          <div className="admin"><div className="avatar">{(session.name || "A")[0]}</div><div><b>{session.name || "Admin User"}</b><span>{session.role || "Authorized Admin"}</span></div><button className="secondary-btn" onClick={logout}>Logout</button></div>
        </header>

        {isStaff ? <>
          {page === "Dashboard" && <Dashboard users={users} franchises={franchises} orders={orders} commissions={commissions} hierarchy={hierarchy} metrics={dashboardData?.metrics} latestLocation={dashboardData?.latest_location} loading={loading} refresh={load}/>}
          {page === "Employees" && <EmployeeManagement session={session} notify={notify}/>}
          {page === "Customers" && <Customers users={users} setUsers={setUsers} notify={notify} isAdmin={isAdmin}/>}
          {page === "Locations" && isAdmin && <Locations users={users} franchises={franchises} notify={notify}/>}
          {page === "Franchises" && ["ADMIN", "HQ"].includes(session.role) && <Franchises franchises={franchises} boundaries={boundaries} setFranchises={setFranchises} refresh={load} notify={notify}/>}
          {page === "Orders" && <Orders orders={orders} users={users} refresh={load} notify={notify} onManageLocations={() => setPage("Locations")}/>}
          {page === "Mobile Recharge" && <Orders orders={orders} users={users} refresh={load} notify={notify} onManageLocations={() => setPage("Locations")} serviceFilter={MOBILE_RECHARGE_SERVICE_ID}/>}
          {page === "Attribution" && <Attribution franchises={franchises} orders={orders} isAdmin={isAdmin}/>}
          {page === "Commissions" && <Commissions commissions={commissions} refresh={load} notify={notify} isAdmin={isAdmin}/>}
          {page === "Wallet" && <Wallet session={session} franchises={franchises} notify={notify}/>}
          {page === "Reports" && <Reports users={users} orders={orders} boundaries={boundaries}/>}
          {page === "Audit Logs" && <AuditLogs logs={auditLogs}/>}
          {page === "Staff Access" && <StaffAccounts franchises={franchises} notify={notify}/>}
        </> : isEmployee
          ? <EmployeeManagement session={session} notify={notify}/>
          : <CustomerPortal user={session} notify={notify}/>}
      </main>
    </div>
  );
}

function Landing({ onRegister, onAdminLogin, onCustomerLogin }) {
  return <div className="landing-page">
    <header className="landing-nav">
      <a className="landing-brand" href="#" onClick={event => event.preventDefault()}>
        <img src="/zyngram-logo.png" alt="" />
        <span>Zyngram<small>FRANCHISE CLOUD</small></span>
      </a>
      <nav aria-label="Main navigation"><a href="#platform">Platform</a><a href="#workflow">How it works</a></nav>
      <div className="landing-actions">
        <button className="landing-signin" onClick={onAdminLogin}>Admin sign in</button>
        <button className="landing-nav-cta" onClick={onRegister}>Create account <span>↗</span></button>
      </div>
    </header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span/> ONE CONNECTED FRANCHISE PLATFORM</div>
          <h1>Every location.<br/><em>One clear picture.</em></h1>
          <p>Bring customer locations, franchise operations, orders and commissions together in one beautifully simple workspace.</p>
          <div className="hero-actions">
            <button className="hero-primary" onClick={onRegister}>Create your account <span>→</span></button>
            <button className="hero-secondary" onClick={onCustomerLogin}><span className="play-mark">↗</span> Customer sign in</button>
          </div>
          <div className="hero-proof"><div className="proof-avatars"><i>F</i><i>O</i><i>G</i></div><span>One connected flow<br/><strong>From customer to commission</strong></span></div>
        </div>
        <div className="hero-art" aria-label="Illustration of the Zyngram franchise dashboard">
          <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
          <div className="dashboard-preview">
            <div className="preview-top"><div className="preview-brand"><b>Z</b> Zyngram</div><span className="preview-status"><i/> LIVE OVERVIEW</span></div>
            <div className="preview-title"><div><small>YOUR NETWORK AT A GLANCE</small><strong>Good morning, Admin</strong></div><span className="preview-avatar">A</span></div>
            <div className="preview-metrics"><div><small>FRANCHISE OPERATIONS</small><b>Connected</b><span>One clear hierarchy</span></div><div><small>ORDER WORKFLOW</small><b>Tracked</b><span>Location to ledger</span></div></div>
            <div className="preview-map"><div className="map-contours"/><span className="map-region region-a">NORTH</span><span className="map-region region-b">CENTRAL</span><span className="map-region region-c">SOUTH</span><i className="map-marker marker-a"/><i className="map-marker marker-b"/><i className="map-marker marker-c"/><div className="map-legend"><i/> Verified locations</div></div>
            <div className="preview-hierarchy"><div><span>COMMAND</span><b>Your command</b></div><i>→</i><div><span>HUB</span><b>Your hub</b></div><i>→</i><div><span>POINT</span><b>Mapped points</b></div></div>
          </div>
          <div className="floating-commission"><span className="commission-icon">↗</span><div><small>COMMISSIONS TRACKED</small><strong>Point to Command</strong></div><span className="commission-check">✓</span></div>
          <div className="hero-stamp"><span>BUILT FOR<br/><b>GROWTH</b></span><i>✳</i></div>
        </div>
        <div className="hero-vertical-label">GROW WITH CLARITY&nbsp; · &nbsp;GROW WITH CLARITY</div>
      </section>
      <section id="platform" className="platform-strip"><div><span className="strip-kicker">ONE WORKSPACE.</span><strong>Every moving part, connected.</strong></div><div className="platform-features"><span><i>⌖</i> Geo-mapping</span><span><i>⌂</i> Franchise hierarchy</span><span><i>↗</i> Orders & attribution</span><span><i>◎</i> Commission ledger</span></div></section>
      <section id="workflow" className="landing-workflow"><div><span className="eyebrow"><span/> SIMPLE BY DESIGN</span><h2>From first pin<br/>to final payout.</h2></div><p>Capture a service location, match it to a configured franchise boundary, and keep every order and commission traceable from one trusted source.</p><button onClick={onRegister}>Get started <span>→</span></button></section>
      <footer className="landing-footer"><a className="landing-brand" href="#" onClick={event => event.preventDefault()}><img src="/zyngram-logo.png" alt=""/><span>Zyngram<small>FRANCHISE CLOUD</small></span></a><span>Franchise operations, made clearer.</span><button onClick={onAdminLogin}>Administrator access ↗</button></footer>
    </main>
  </div>;
}

function Registration({ onBack, onCustomerLogin, onRegister }) {
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "", confirmPassword: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async event => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onRegister({
        name: form.name,
        email: form.email,
        mobile: form.mobile,
        password: form.password
      });
    } catch (error) {
      setMessage(error.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-page">
    <button type="button" className="auth-back" onClick={onBack}>← Back to home</button>
    <form className="login-card" onSubmit={submit}>
      <img className="brand-logo" src="/zyngram-logo.png" alt="Zyngram" />
      <h1>Create your account</h1>
      <p>Join Zyngram to manage your service locations and bookings.</p>
      <label>Full Name</label><input type="text" autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Enter your full name" required/>
      <label>Email</label><input type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" required/>
      <label>Mobile Number</label><input type="tel" autoComplete="tel" value={form.mobile} onChange={event => setForm({ ...form, mobile: event.target.value })} placeholder="Enter your mobile number" required/>
      <label>Password</label><input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" required/>
      <label>Confirm Password</label><input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} placeholder="Confirm your password" required/>
      {message && <div className="error-state" role="alert">{message}</div>}
      <button type="submit" className="primary-btn" disabled={busy}>{busy ? "Creating your account…" : "Create customer account"}</button>
      <small>Already registered? <button type="button" className="inline-auth-link" onClick={onCustomerLogin}>Customer sign in</button></small>
    </form>
  </div>;
}

function Login({ adminMode, onBack, onRegister, onLogin }) {
  const [email, setEmail] = useState(adminMode ? "admin@zyngram.com" : "");
  const [password, setPassword] = useState(adminMode ? "admin123" : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await onLogin({ email, password });
    } catch (error) {
      setMessage(error.message || "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="auth-page">
    <button type="button" className="auth-back" onClick={onBack}>← Back to home</button>
    <form className="login-card" onSubmit={submit}>
    <img className="brand-logo" src="/zyngram-logo.png" alt="Zyngram" /><h1>{adminMode ? "Administrator sign in" : "Customer sign in"}</h1><p>{adminMode ? "Sign in to manage franchise operations." : "Sign in to view your customer dashboard, locations and bookings."}</p>
    <label>Email</label><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required/>
    <label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/>
    {message && <div className="error-state" role="alert">{message}</div>}
    <button className="primary-btn" disabled={busy}>{busy ? "Signing in…" : adminMode ? "Sign in to admin portal" : "Sign in to customer dashboard"}</button>
    {!adminMode && <button type="button" className="secondary-btn" onClick={onRegister}>Create customer account</button>}
      {adminMode && import.meta.env.DEV && <div className="admin-credentials"><span>LOCAL DEMO ADMIN</span><b>admin@zyngram.com</b><b>admin123</b></div>}
    </form>
  </div>;
}

function CustomerPortal({ user, notify }) {
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [rechargeForm, setRechargeForm] = useState({
    mobile_number: "",
    operator: "",
    circle: "",
    amount: ""
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [liveCoordinates, setLiveCoordinates] = useState(null);
  const [trackPoints, setTrackPoints] = useState([]);
  const watchId = useRef(null);
  const trackingGeneration = useRef(0);

  const refresh = useCallback(async () => {
    setLoadError("");
    const [locationResult, orderResult, serviceResult] = await Promise.allSettled([
      api(`/api/locations/user/${encodeURIComponent(user.id)}`),
      api("/api/orders"),
      api("/api/services")
    ]);

    if (locationResult.status === "fulfilled") {
      const savedLocations = (locationResult.value.locations || [])
        .slice()
        .sort((left, right) => new Date(right.captured_at) - new Date(left.captured_at));
      const hydrated = await Promise.all(savedLocations.map(async location => {
        const [geoResult, mappingResult] = await Promise.allSettled([
          api("/api/geo/reverse-geocode", {
            method: "POST",
            body: JSON.stringify({ lat: location.lat, lon: location.lon })
          }),
          api(`/api/geo/franchise-map?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}&location_id=${encodeURIComponent(location.id)}`)
        ]);
        return {
          ...location,
          geography: geoResult.status === "fulfilled" ? geoResult.value : null,
          geographyError: geoResult.status === "rejected" ? geoResult.reason.message : "",
          mapping: mappingResult.status === "fulfilled" ? mappingResult.value.mapping : null,
          mappingError: mappingResult.status === "rejected" ? mappingResult.reason.message : ""
        };
      }));
      setLocations(hydrated);
      const eligibleLocations = hydrated.filter(isBookableLocation);
      setSelectedLocationId(current => eligibleLocations.some(location => location.id === current)
        ? current
        : eligibleLocations[0]?.id || "");
    } else {
      setLoadError(locationResult.reason.message || "Unable to load your saved locations.");
    }

    if (orderResult.status === "fulfilled") setOrders(orderResult.value.orders || []);
    else setLoadError(orderResult.reason.message || "Unable to load your bookings.");

    if (serviceResult.status === "fulfilled") {
      const availableServices = serviceResult.value.services || [];
      setServices(availableServices);
      setSelectedServiceId(current => availableServices.some(service => service.id === current)
        ? current
        : availableServices[0]?.id || "");
    } else {
      setLoadError(serviceResult.reason.message || "Unable to load available services.");
    }
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    const timer = setTimeout(() => { refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => () => {
    trackingGeneration.current += 1;
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
  }, []);

  const stopTracking = () => {
    trackingGeneration.current += 1;
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
    setTracking(false);
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setTrackingError("This browser does not support location tracking.");
      return;
    }
    setTrackingError("");
    setLiveCoordinates(null);
    setTrackPoints([]);
    setTracking(true);
    const generation = ++trackingGeneration.current;
    try {
      watchId.current = navigator.geolocation.watchPosition(
        result => {
          if (trackingGeneration.current !== generation) return;
          const point = {
            lat: result.coords.latitude,
            lon: result.coords.longitude,
            accuracy: result.coords.accuracy,
            timestamp: result.timestamp
          };
          setLiveCoordinates(point);
          setTrackPoints(current => [...current, point].slice(-100));
        },
        error => {
          if (trackingGeneration.current !== generation) return;
          stopTracking();
          setTrackingError(error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser settings, then try again."
            : error.code === error.TIMEOUT
              ? "Location detection timed out. Try again where the GPS signal is clearer."
              : "Unable to read your location. Check your device location settings and try again.");
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } catch (error) {
      trackingGeneration.current += 1;
      setTracking(false);
      setTrackingError(error instanceof Error ? error.message : "Unable to start location tracking.");
    }
  };

  const saveCoordinates = async (coordinates, source) => {
    try {
      const [geoResult] = await Promise.allSettled([
        api("/api/geo/reverse-geocode", {
          method: "POST",
          body: JSON.stringify(coordinates)
        })
      ]);
      const geocoded = geoResult.status === "fulfilled" ? geoResult.value : null;
      const address = geocoded?.address
        ? [geocoded.address.city, geocoded.address.district, geocoded.address.state, geocoded.address.country]
          .filter(Boolean)
          .join(", ")
        : "";
      const saved = await api("/api/locations/capture", {
        method: "POST",
        body: JSON.stringify({ ...coordinates, source, address })
      });
      const mapping = saved.mapping;
      const location = {
        ...saved.location,
        geography: geocoded,
        geographyError: geoResult.status === "rejected" ? geoResult.reason.message : "",
        mapping
      };
      setLocations(current => [location, ...current]);
      if (isBookableLocation(location)) setSelectedLocationId(location.id);
      if (mapping?.mapped && !location.geographyError) {
        notify(source === "test"
          ? "Demo test location saved and matched to its configured franchise."
          : "Location saved and matched to your service franchise.");
      } else if (location.geographyError) {
        notify("Location saved and franchise mapping checked, but address lookup is unavailable.", "warning");
      } else {
        notify("Location saved, but no configured franchise covers it yet.", "warning");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const capture = () => {
    if (!navigator.geolocation) {
      notify("This browser does not support location access.", "error");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      result => {
        saveCoordinates({
          lat: result.coords.latitude,
          lon: result.coords.longitude,
          accuracy: result.coords.accuracy
        }, "browser");
      },
      error => {
        setBusy(false);
        notify(error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. You can enable it in your browser settings."
          : error.code === error.TIMEOUT
            ? "Location detection timed out. Please try again in a place with a clearer GPS signal."
            : "Unable to detect your location. Please try again.", "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const useDemoLocation = () => {
    setBusy(true);
    saveCoordinates({ lat: 17.6868, lon: 83.2185, accuracy: 10 }, "test");
  };

  const selectedLocation = locations.find(location => location.id === selectedLocationId);
  const selectedService = services.find(service => service.id === selectedServiceId);
  const bookableLocations = locations.filter(isBookableLocation);
  const canBook = isBookableLocation(selectedLocation) &&
    Boolean(selectedService) &&
    !bookingBusy;

  const createBooking = async event => {
    event.preventDefault();
    if (!canBook) return;
    setBookingBusy(true);
    try {
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          service_id: selectedService.id,
          location_id: selectedLocation.id,
          ...(selectedService.pricing_type === "CUSTOMER_AMOUNT" ? rechargeForm : {})
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() }
      });
      setOrders(current => [result.order, ...current]);
      notify(`Booking ${result.order.id} created.`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBookingBusy(false);
    }
  };

  return <div className="content customer-content">
    <section className="customer-welcome"><div><span className="eyebrow"><span/> YOUR CUSTOMER SPACE</span><h2>Hello, {user.name.split(" ")[0]}.</h2><p>Your account is ready. Save a service location to get started.</p></div><div className="customer-avatar">{user.name.charAt(0).toUpperCase()}</div></section>
    <div className="customer-grid">
      <section className="card customer-profile"><span className="customer-card-icon">◎</span><span className="customer-card-kicker">YOUR PROFILE</span><h3>Account details</h3><div className="profile-detail"><span>Full name</span><strong>{user.name}</strong></div><div className="profile-detail"><span>Email address</span><strong>{user.email}</strong></div><div className="profile-detail"><span>Account type</span><strong>Customer</strong></div><span className="account-status"><i/> Account active</span></section>
      <section className="card customer-location"><span className="customer-card-icon">⌖</span><span className="customer-card-kicker">SERVICE LOCATION</span><h3>Save a location</h3><p>Share your device location to find the franchise that serves you. Your coordinates are only saved when you choose to share them.</p><div className="customer-location-buttons"><button className="primary-btn" onClick={capture} disabled={busy}>{busy ? "Detecting and mapping…" : "Use my current location"}</button><button className="secondary-btn" onClick={useDemoLocation} disabled={busy}>Use configured demo location</button></div><small className="privacy-note">The demo option uses a clearly labelled Visakhapatnam test coordinate inside the sample franchise boundary.</small></section>
    </div>
    <section className="card live-tracking-card">
      <Header title="Live location" sub="Turn tracking on to see your device move. Your live trail stays in this browser and is not saved automatically." badge={tracking ? "TRACKING" : "OFF"}/>
      <div className="live-tracking-content">
        <div className="live-tracking-map">
          <LiveLocationMap coordinates={liveCoordinates} points={trackPoints}/>
        </div>
        <div className="live-tracking-details">
          <span className={`live-tracking-indicator ${tracking ? "active" : ""}`}><i/>{tracking ? "Live tracking is on" : liveCoordinates ? "Tracking is off · last location shown" : "Tracking is off"}</span>
          {liveCoordinates
            ? <div className="live-coordinate-values"><strong>{Number(liveCoordinates.lat).toFixed(6)}, {Number(liveCoordinates.lon).toFixed(6)}</strong><span>GPS accuracy ±{Math.round(liveCoordinates.accuracy)} m</span><span>Updated {new Date(liveCoordinates.timestamp).toLocaleTimeString()}</span></div>
            : <p className="live-location-empty">Start tracking to show your current GPS position here.</p>}
          {trackingError && <div className="location-warning" role="alert">{trackingError}</div>}
          <div className="live-tracking-buttons">
            <button className={tracking ? "secondary-btn" : "primary-btn"} onClick={tracking ? stopTracking : startTracking}>{tracking ? "Stop live tracking" : "Start live tracking"}</button>
            <button className="secondary-btn" onClick={() => liveCoordinates && saveCoordinates({ lat: liveCoordinates.lat, lon: liveCoordinates.lon, accuracy: liveCoordinates.accuracy }, "browser")} disabled={!liveCoordinates || busy}>{busy ? "Saving…" : "Save current location"}</button>
          </div>
          <small className="privacy-note">Saving is always a separate action. Stop tracking at any time; location permission is controlled by your browser.</small>
        </div>
      </div>
    </section>
    {loadError && <div className="error-state" role="alert">{loadError}<button className="inline-auth-link" onClick={() => { setLoading(true); refresh(); }}> Retry</button></div>}

    <section className="card customer-locations-card">
      <Header title="Your saved locations" sub="Address lookup is marked as a demo provider; franchise matching uses configured boundaries." badge={loading ? "LOADING" : `${locations.length} SAVED`}/>
      {loading ? <Loading msg="Loading your locations…"/> : locations.length === 0
        ? <EmptyState title="No service location yet" message="Capture your location above. We’ll show the resolved area and matching franchise here."/>
        : <div className="customer-location-list">{locations.map(location => {
          const mapped = location.mapping?.mapped === true;
          const accuracyWarning = !Number.isFinite(Number(location.accuracy)) || Number(location.accuracy) <= 0 || Number(location.accuracy) > 100;
          return <article className={`saved-location ${selectedLocationId === location.id ? "selected" : ""}`} key={location.id}>
            <div className="saved-location-top"><div><span className="customer-card-kicker">{location.source === "test" ? "DEMO TEST LOCATION" : "SAVED SERVICE LOCATION"}</span><h4>{location.address || location.geography?.address?.city || "Address not resolved by mock provider"}</h4></div>
              <span className={`location-status ${accuracyWarning ? "low" : mapped ? "mapped" : location.mappingError ? "low" : "unmapped"}`}>{accuracyWarning ? "LOW ACCURACY" : mapped ? "MAPPED" : location.mappingError ? "LOOKUP UNAVAILABLE" : "UNMAPPED"}</span></div>
            <div className="saved-location-details"><span>{Number(location.lat).toFixed(5)}, {Number(location.lon).toFixed(5)}</span><span>±{Math.round(Number(location.accuracy))} m</span><span>{dateText(location.captured_at)}</span></div>
            {location.geography?.address && <div className="geography-line">DEMO GEOCODE · {[location.geography.address.city, location.geography.address.district, location.geography.address.state, location.geography.address.country].filter(Boolean).join(", ")}</div>}
            {location.geographyError && <div className="location-warning">Address lookup unavailable: {location.geographyError}</div>}
            {location.mapping?.mapped
              ? <div className="customer-hierarchy">{["point", "center", "hub", "command", "node", "zone", "territory", "region", "nation"].filter(level => location.mapping[level]).map(level => <div key={level}><span>{level.toUpperCase()}</span><strong>{location.mapping[level].name}</strong></div>)}</div>
              : <div className={accuracyWarning || location.mappingError ? "location-warning" : "location-unmapped"}>{location.mappingError
                ? `Franchise lookup unavailable: ${location.mappingError}`
                : accuracyWarning
                ? "GPS accuracy is too low for a booking. Try again outdoors for a more precise location."
                : "No configured franchise boundary covers this location. You can still save it, but bookings need a mapped service location."}</div>}
            <div className="saved-location-actions"><Map lat={location.lat} lon={location.lon} mapped={mapped} boundaryGeometry={location.mapping?.boundary_geometry} boundaryId={location.mapping?.boundary_id}/><button className={selectedLocationId === location.id ? "location-selected-btn" : "secondary-btn"} onClick={() => setSelectedLocationId(location.id)} disabled={!isBookableLocation(location)}>{selectedLocationId === location.id ? "Selected for booking" : "Use for booking"}</button></div>
          </article>;
        })}</div>}
    </section>

    <section className="card customer-booking-card">
      <Header title="Book a service" sub="Select an available service and a mapped location to create a booking." badge="DEMO SERVICE"/>
      {!loading && locations.length === 0
        ? <EmptyState title="Save a location first" message="You need a GPS location inside a configured franchise boundary before booking."/>
        : <form className="customer-booking-form" onSubmit={createBooking}>
          <div className="customer-booking-fields">
            <div><label htmlFor="booking-service">Service</label><select id="booking-service" value={selectedServiceId} onChange={event => setSelectedServiceId(event.target.value)} required><option value="" disabled>Select a service</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}{service.pricing_type === "CUSTOMER_AMOUNT" ? " — enter amount" : ` — ${money(service.amount)}`}</option>)}</select>{selectedService && <small>{selectedService.description}</small>}</div>
            <div><label htmlFor="booking-location">Mapped service location</label><select id="booking-location" value={selectedLocationId} onChange={event => setSelectedLocationId(event.target.value)} required><option value="" disabled>{bookableLocations.length ? "Select a mapped location" : "No eligible mapped location"}</option>{bookableLocations.map(location => <option key={location.id} value={location.id}>{location.address || `${Number(location.lat).toFixed(4)}, ${Number(location.lon).toFixed(4)}`} — {location.mapping.point?.name || "Mapped franchise"}</option>)}</select><small>{bookableLocations.length ? "Only mapped locations with GPS accuracy of 100 m or better can be booked." : "Use a saved location marked MAPPED with GPS accuracy of 100 m or better."}</small></div>
          </div>
          {selectedService?.pricing_type === "CUSTOMER_AMOUNT" && <div className="customer-booking-fields">
            <div><label htmlFor="recharge-mobile">Mobile number</label><input id="recharge-mobile" type="tel" inputMode="numeric" autoComplete="tel" pattern="[6-9][0-9]{9}" maxLength="10" placeholder="10-digit Indian number" value={rechargeForm.mobile_number} onChange={event => setRechargeForm(current => ({ ...current, mobile_number: event.target.value.replace(/\D/g, "").slice(0, 10) }))} required /></div>
            <div><label htmlFor="recharge-operator">Operator</label><select id="recharge-operator" value={rechargeForm.operator} onChange={event => setRechargeForm(current => ({ ...current, operator: event.target.value }))} required><option value="" disabled>Select operator</option>{selectedService.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></div>
            <div><label htmlFor="recharge-circle">Circle</label><select id="recharge-circle" value={rechargeForm.circle} onChange={event => setRechargeForm(current => ({ ...current, circle: event.target.value }))} required><option value="" disabled>Select circle</option>{selectedService.circles.map(circle => <option key={circle} value={circle}>{circle}</option>)}</select></div>
            <div><label htmlFor="recharge-amount">Recharge amount (₹)</label><input id="recharge-amount" type="number" min={selectedService.min_amount} max={selectedService.max_amount} step="1" value={rechargeForm.amount} onChange={event => setRechargeForm(current => ({ ...current, amount: event.target.value }))} required /><small>₹{selectedService.min_amount}–₹{selectedService.max_amount}; validated again by the backend.</small></div>
          </div>}
          {selectedService && <div className="booking-price"><span>{selectedService.pricing_type === "CUSTOMER_AMOUNT" ? "RECHARGE AMOUNT" : "DEMO SERVICE PRICE"}</span><strong>{selectedService.pricing_type === "CUSTOMER_AMOUNT" ? money(rechargeForm.amount) : money(selectedService.amount)}</strong><small>{selectedService.pricing_type === "CUSTOMER_AMOUNT" ? "Demo workflow only: no telecom operator or payment-provider API is connected. Franchise mapping, order amount and commissions are validated by the backend." : "Price comes from the backend service catalog. Franchise and commission assignment is always calculated by the server."}</small></div>}
          <button className="primary-btn" disabled={!canBook}>{bookingBusy ? "Creating booking…" : selectedService?.id === "SERVICE-MOBILE-RECHARGE" ? "Create recharge order" : "Confirm service booking"}</button>
          {!canBook && locations.length > 0 && <p className="booking-hint">{bookableLocations.length ? "Choose a mapped location with GPS accuracy of 100 m or better to continue." : "None of your saved locations currently meet the mapping and GPS accuracy requirements."}</p>}
        </form>}
    </section>

    <section className="card customer-bookings-card">
      <Header title="Your bookings" sub="Only bookings made from your account are shown here." badge={`${orders.length} BOOKINGS`}/>
      {loading ? <Loading msg="Loading your bookings…"/> : orders.length === 0
        ? <EmptyState title="No bookings yet" message="Once you book a service, its status and order reference will appear here."/>
        : <Table headers={["Booking","Service","Amount","Status","Placed"]} rows={orders.map(order => [
          order.id,
          <span>{services.find(service => service.id === order.service_id)?.name || order.service_id}{order.details?.mobile_number && <small>{order.details.operator_name} · {order.details.mobile_number} · {order.details.circle}</small>}</span>,
          money(order.amount),
          <span className={`badge ${order.status === "CONFIRMED" ? "success" : "warning"}`}>{order.details?.processing_mode === "DEMO" && order.status === "CONFIRMED" ? "DEMO_COMPLETED" : order.status}{order.details?.processing_mode === "DEMO" && <small>No telecom recharge submitted.</small>}</span>,
          dateText(order.created_at)
        ])} empty="No bookings"/>}
      <button className="secondary-btn" onClick={() => { setLoading(true); refresh(); }} disabled={loading}>Refresh my bookings</button>
    </section>
  </div>;
}

function StaffAccounts({ franchises, notify }) {
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "", role: "HQ", franchise_id: "" });
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/admins", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", mobile: "", password: "", role: "HQ", franchise_id: "" });
      notify("Staff account created.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return <div className="content"><section className="card"><Header title="Staff access" sub="Only administrators can create privileged accounts."/><form className="staff-form" onSubmit={submit}>
    <div className="form-grid">
      <Field label="Full name" value={form.name} set={value => setForm({ ...form, name: value })}/>
      <Field label="Email" type="email" value={form.email} set={value => setForm({ ...form, email: value })}/>
      <Field label="Mobile" type="tel" value={form.mobile} set={value => setForm({ ...form, mobile: value })}/>
      <Field label="Temporary password (8+ characters)" type="password" value={form.password} set={value => setForm({ ...form, password: value })}/>
      <div><label>Access role</label><select value={form.role} onChange={event => setForm({ ...form, role: event.target.value, franchise_id: "" })}><option value="HQ">Headquarters</option><option value="COMMAND">Command</option><option value="HUB">Hub</option><option value="CENTER">Center</option><option value="ADMIN">Administrator</option></select></div>
      {["COMMAND","HUB","CENTER"].includes(form.role)&&<div><label>Assigned franchise</label><select required value={form.franchise_id} onChange={event=>setForm({...form,franchise_id:event.target.value})}><option value="">Select active {form.role.toLowerCase()}</option>{franchises.filter(item=>item.status==="ACTIVE"&&item.level===({COMMAND:"Command",HUB:"Hub",CENTER:"Center"}[form.role])).map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></div>}
    </div>
    <button className="primary-btn" disabled={busy}>{busy ? "Creating account…" : "Create staff account"}</button>
  </form></section></div>;
}

function Dashboard({users,franchises,orders,commissions,hierarchy,metrics,latestLocation,loading,refresh}) {
  const total = commissions.reduce((s,x)=>s+Number(x.amount||0),0);
  const mapped = latestLocation?.mapping?.mapped === true;
  return <div className="content">
    <div className="welcome"><div><h2>Franchise Operations Overview</h2><p>Customer → Location → Geo Mapping → Franchise → Order → Attribution → Commission → Ledger</p></div><span className="live-badge">● SYSTEM ONLINE</span></div>
    <div className="stats">
      <Stat title="Customers" value={loading?"...":metrics?.customers ?? users.length} sub="Registered users"/>
      <Stat title="Franchises" value={loading?"...":metrics?.franchises ?? franchises.length} sub="Configured hierarchy"/>
      <Stat title="Mapped locations" value={loading?"...":metrics?.mapped_locations ?? 0} sub="Verified franchise matches"/>
      <Stat title="Orders" value={loading?"...":metrics?.orders ?? orders.length} sub="Transactions"/>
      <Stat title="Commission" value={money(metrics?.commission_total ?? total)} sub="Ledger total"/>
      <Stat title="Pending commission" value={money(metrics?.pending_commission_total ?? commissions.filter(entry=>entry.settlement_status!=="SETTLED").reduce((sum,entry)=>sum+Number(entry.amount||0),0))} sub="Awaiting settlement"/>
      <Stat title="Wallet balance" value={money(metrics?.wallet_balance ?? 0)} sub="Settled owner ledger"/>
    </div>
    <div className="dashboard-grid">
      <section className="card"><Header title="Franchise Hierarchy" sub="Command → Hub → Center → Point" badge="CONFIGURED"/>
        <div className="hierarchy"><HItem level="Command" item={hierarchy.command}/><div className="connector"/><HItem level="Hub" item={hierarchy.hub}/><div className="connector"/><HItem level="Center" item={hierarchy.center}/><div className="connector"/><HItem level="Point" item={hierarchy.point}/></div>
      </section>
      <section className="card"><Header title="Customer Geo Mapping" sub="Latest saved customer location" badge={latestLocation ? mapped ? "MAPPED" : "UNMAPPED" : "NO DATA"}/>
        {latestLocation ? <><Map lat={latestLocation.lat} lon={latestLocation.lon} mapped={mapped}/>
          <div className="location-info"><div><span>Latitude</span><b>{latestLocation.lat}</b></div><div><span>Longitude</span><b>{latestLocation.lon}</b></div><div><span>Accuracy</span><b>{latestLocation.accuracy} m</b></div></div>
          <div className={mapped ? "success-state" : "error-state"}>{mapped ? `Mapped to ${latestLocation.mapping.point?.name || "franchise point"}` : "UNMAPPED — no configured boundary contains this location."}</div></>
          : <EmptyState title="No customer locations yet" message="A location will appear here after a customer chooses to share one."/>}
      </section>
    </div>
    <section className="card"><Header title="Transaction Flow" sub="One connected Day 10 transaction"/><div className="flow">{["Customer","Location","Geo Mapping","Franchise","Order","Attribution","Commission","Ledger"].map((x,i)=><span className="flow-wrap" key={x}><FlowStep n={i+1} text={x}/>{i<7&&<FlowArrow/>}</span>)}</div><button className="secondary-btn" onClick={refresh}>Refresh Backend Data</button></section>
  </div>;
}

function Customers({users,setUsers,notify,isAdmin=true}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[query,setQuery]=useState(""),[statusFilter,setStatusFilter]=useState("ALL"),[selected,setSelected]=useState(null),[form,setForm]=useState({name:"",mobile:"",email:""});
  const customers=users.filter(user=>(!user.role||user.role==="CUSTOMER")&&(statusFilter==="ALL"||(user.status||"ACTIVE")===statusFilter)&&[user.id,user.name,user.email,user.mobile].some(value=>String(value||"").toLowerCase().includes(query.toLowerCase())));
  async function submit(e){e.preventDefault();setBusy(true);try{const d=await api("/api/users",{method:"POST",body:JSON.stringify(form)});setUsers(x=>[...x,(d.user||d)]);setOpen(false);setForm({name:"",mobile:"",email:""});notify("Customer created");}catch(e){notify(e.message,"error")}finally{setBusy(false)}}
  const saveSelected=async event=>{event.preventDefault();setBusy(true);try{const result=await api(`/api/users/${selected.id}`,{method:"PATCH",body:JSON.stringify({name:selected.name,email:selected.email,mobile:selected.mobile})});setUsers(items=>items.map(user=>user.id===selected.id?result.user:user));setSelected(result.user);notify("Customer profile updated")}catch(error){notify(error.message,"error")}finally{setBusy(false)}};
  const toggleStatus=async customer=>{const status=customer.status==="INACTIVE"?"ACTIVE":"INACTIVE";try{const result=await api(`/api/users/${customer.id}`,{method:"PATCH",body:JSON.stringify({status})});setUsers(items=>items.map(user=>user.id===customer.id?result.user:user));notify(`Customer ${status.toLowerCase()}`)}catch(error){notify(error.message,"error")}};
  return <div className="content"><section className="card"><Header title="Customer Management" sub="Search customer accounts, edit profiles, and manage account status"/><div className="toolbar"><input aria-label="Search customers" placeholder="Search name, email, mobile or ID" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter customers by status" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>{isAdmin&&<button className="primary-btn" onClick={()=>setOpen(true)}>+ Add Customer</button>}</div><Table headers={["ID","Name","Mobile","Email","Status","Details","Actions"]} rows={customers.map(x=>[x.id,x.name,x.mobile,x.email,<span className={`badge ${x.status==="ACTIVE"?"success":"muted"}`}>{x.status||"ACTIVE"}</span>,<button className="secondary-btn" onClick={()=>setSelected({...x})}>{isAdmin?"View / edit":"View profile"}</button>,isAdmin?<button className="secondary-btn" onClick={()=>toggleStatus(x)}>{x.status==="INACTIVE"?"Activate":"Deactivate"}</button>:"—"])} empty="No customers match these filters"/></section>{selected&&<Modal title={isAdmin?"Edit customer profile":"Customer profile"} close={()=>setSelected(null)}>{isAdmin?<form onSubmit={saveSelected}><Field label="Name" value={selected.name} set={value=>setSelected({...selected,name:value})}/><Field label="Email" type="email" value={selected.email} set={value=>setSelected({...selected,email:value})}/><Field label="Mobile" value={selected.mobile} set={value=>setSelected({...selected,mobile:value})}/><div className="snapshot-info"><div><span>Account ID</span><b>{selected.id}</b></div><div><span>Status</span><b>{selected.status||"ACTIVE"}</b></div><div><span>Registered</span><b>{dateText(selected.created_at)}</b></div></div><button className="primary-btn" disabled={busy}>{busy?"Saving…":"Save profile"}</button></form>:<div className="snapshot-info"><div><span>Name</span><b>{selected.name}</b></div><div><span>Email</span><b>{selected.email}</b></div><div><span>Mobile</span><b>{selected.mobile}</b></div><div><span>Account ID</span><b>{selected.id}</b></div><div><span>Status</span><b>{selected.status||"ACTIVE"}</b></div><div><span>Registered</span><b>{dateText(selected.created_at)}</b></div></div>}</Modal>}{open&&<Modal title="Register Customer" close={()=>setOpen(false)}><form onSubmit={submit}><Field label="Name" value={form.name} set={v=>setForm({...form,name:v})}/><Field label="Mobile" value={form.mobile} set={v=>setForm({...form,mobile:v})}/><Field label="Email" value={form.email} set={v=>setForm({...form,email:v})} type="email"/><button className="primary-btn" disabled={busy}>{busy?"Saving...":"Create Customer"}</button></form></Modal>}</div>;
}

function Locations({users,franchises,notify}) {
  const [userId,setUserId]=useState(""),[pos,setPos]=useState({lat:17.6868,lon:83.2185,accuracy:10}),[busy,setBusy]=useState(false),[mapping,setMapping]=useState(null),[allLocations,setAllLocations]=useState([]),[correction,setCorrection]=useState({location_id:"",point_id:"",reason:""});
  useEffect(()=>{let active=true;Promise.allSettled(users.map(user=>api(`/api/locations/user/${encodeURIComponent(user.id)}`))).then(results=>{if(active){const failures=results.filter(result=>result.status==="rejected");if(failures.length)notify(`${failures.length} customer location list(s) could not be loaded: ${failures.map(result=>result.reason.message).join("; ")}`,"warning");const saved=results.flatMap(result=>result.status==="fulfilled"?result.value.locations||[]:[]);setAllLocations(saved);setCorrection(current=>({...current,location_id:current.location_id||saved[0]?.id||""}))}});return()=>{active=false}},[users,notify]);
  const gps=()=>{if(!navigator.geolocation)return notify("Geolocation is not supported","error");setBusy(true);navigator.geolocation.getCurrentPosition(p=>{setPos({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy});setBusy(false);notify("Browser location captured")},()=>{setBusy(false);notify("Location permission denied or unavailable","error")},{enableHighAccuracy:true,timeout:10000,maximumAge:0})};
  const save=async()=>{try{setBusy(true);const result=await api("/api/locations/capture",{method:"POST",body:JSON.stringify({user_id:userId,lat:pos.lat,lon:pos.lon,accuracy:pos.accuracy,source:"browser"})});setAllLocations(items=>[result.location,...items]);notify("Location saved")}catch(e){notify(e.message,"error")}finally{setBusy(false)}};
  const map=async()=>{try{setBusy(true);const d=await api("/api/geo-mapping/map",{method:"POST",body:JSON.stringify({lat:pos.lat,lon:pos.lon})});setMapping(d.mapping);notify(d.mapping?.status||"Mapping checked")}catch(e){setMapping({status:"UNMAPPED"});notify(e.message,"error")}finally{setBusy(false)}};
  const correct=async event=>{event.preventDefault();setBusy(true);try{const result=await api("/api/geo/mapping-corrections",{method:"POST",body:JSON.stringify(correction)});setMapping(result.mapping);notify("Mapping correction saved with audit reason")}catch(error){notify(error.message,"error")}finally{setBusy(false)}};
  return <div className="content"><section className="card"><Header title="Location Capture & Geo Mapping" sub="GPS, accuracy and polygon boundary lookup"/><div className="form-grid"><div><label>Customer</label><select value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Select a customer</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div><Field label="Latitude" value={pos.lat} set={v=>setPos({...pos,lat:Number(v)})}/><Field label="Longitude" value={pos.lon} set={v=>setPos({...pos,lon:Number(v)})}/><Field label="Accuracy (m)" value={pos.accuracy} set={v=>setPos({...pos,accuracy:Number(v)})}/></div><div className="button-row"><button className="primary-btn" onClick={gps} disabled={busy}>Capture Browser GPS</button><button className="secondary-btn" onClick={save} disabled={busy||!userId}>Save Location</button><button className="secondary-btn" onClick={map} disabled={busy}>Map to Franchise</button></div><Map lat={pos.lat} lon={pos.lon} mapped={mapping?.status==="MAPPED"} boundaryGeometry={mapping?.boundary_geometry} boundaryId={mapping?.boundary_id}/>  <div className="snapshot-info"><div><span>Accuracy</span><b>{pos.accuracy} m</b></div><div><span>Mapping</span><b>{mapping?.status||"Not checked"}</b></div><div><span>Source</span><b>Browser / Test</b></div></div>{mapping?.status==="MAPPED"&&<div className="mapping-result">{["point","center","hub","command","node","zone","territory","region","nation"].filter(k=>mapping[k]).map(k=><div key={k}><span>{k}</span><b>{mapping[k].name}</b></div>)}</div>}</section><section className="card"><Header title="Saved customer locations" sub={`${allLocations.length} saved locations`}/><Table headers={["Customer","Location","Accuracy","Captured"]} rows={allLocations.map(location=>[users.find(user=>user.id===location.user_id)?.name||location.user_id,location.id,`${location.accuracy} m`,dateText(location.captured_at)])} empty="No saved customer locations"/></section><section className="card"><Header title="Correct a franchise mapping" sub="Administrator corrections are versioned and recorded in the audit log"/><form className="staff-form" onSubmit={correct}><div className="form-grid"><div><label>Saved location</label><select required value={correction.location_id} onChange={e=>setCorrection({...correction,location_id:e.target.value})}><option value="">Select location</option>{allLocations.map(location=><option key={location.id} value={location.id}>{users.find(user=>user.id===location.user_id)?.name||location.user_id} · {location.id}</option>)}</select></div><div><label>Correct Point franchise</label><select required value={correction.point_id} onChange={e=>setCorrection({...correction,point_id:e.target.value})}><option value="">Select Point</option>{franchises.filter(item=>item.level==="Point"&&item.status==="ACTIVE").map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></div><Field label="Reason (10–500 characters)" value={correction.reason} set={value=>setCorrection({...correction,reason:value})}/></div><button className="primary-btn" disabled={busy}>{busy?"Saving…":"Save audited correction"}</button></form></section></div>;
}

function Franchises({franchises,boundaries,setFranchises,refresh,notify}) {
  const [open,setOpen]=useState(false),[boundaryOpen,setBoundaryOpen]=useState(false),[query,setQuery]=useState(""),[levelFilter,setLevelFilter]=useState("ALL"),[statusFilter,setStatusFilter]=useState("ALL"),[edit,setEdit]=useState(null),[form,setForm]=useState({level:"Point",name:"",owner_id:"",parent_id:""}),[boundaryForm,setBoundaryForm]=useState({franchise_id:"",version:"v1",coordinates:'[[[83.20,17.70],[83.24,17.70],[83.24,17.67],[83.20,17.67],[83.20,17.70]]]' }),[busy,setBusy]=useState(false);
  const parentLevel={Point:"Center",Center:"Hub",Hub:"Command",Command:"Node",Node:"Zone",Zone:"Territory",Territory:"Region",Region:"Nation",Nation:null}[form.level];
  const parents=franchises.filter(item=>item.level===parentLevel&&item.status==="ACTIVE");
  const visible=franchises.filter(item=>(levelFilter==="ALL"||item.level===levelFilter)&&(statusFilter==="ALL"||item.status===statusFilter)&&[item.id,item.name,item.owner_id,item.level].some(value=>String(value||"").toLowerCase().includes(query.toLowerCase())));
  const submit=async e=>{e.preventDefault();setBusy(true);try{const d=await api("/api/franchises",{method:"POST",body:JSON.stringify({...form,parent_id:form.parent_id||null})});setFranchises(x=>[...x,(d.franchise||d)]);setOpen(false);notify("Franchise created")}catch(e){notify(e.message,"error")}finally{setBusy(false)}};
  const toggleStatus=async franchise=>{const status=franchise.status==="ACTIVE"?"INACTIVE":"ACTIVE";try{const d=await api(`/api/franchises/${franchise.id}`,{method:"PATCH",body:JSON.stringify({status})});setFranchises(items=>items.map(item=>item.id===franchise.id?d.franchise:item));notify(`Franchise ${status.toLowerCase()}`)}catch(error){notify(error.message,"error")}};
  const saveEdit=async event=>{event.preventDefault();setBusy(true);try{const result=await api(`/api/franchises/${edit.id}`,{method:"PATCH",body:JSON.stringify({name:edit.name,owner_id:edit.owner_id})});setFranchises(items=>items.map(item=>item.id===edit.id?result.franchise:item));setEdit(null);notify("Franchise details updated")}catch(error){notify(error.message,"error")}finally{setBusy(false)}};
  const submitBoundary=async event=>{event.preventDefault();setBusy(true);try{let coordinates;try{coordinates=JSON.parse(boundaryForm.coordinates)}catch{throw new Error("Enter valid JSON polygon coordinates")};const d=await api("/api/geo-boundaries",{method:"POST",body:JSON.stringify({franchise_id:boundaryForm.franchise_id,version:boundaryForm.version,geometry:{type:"Polygon",coordinates}})});notify(`Boundary ${d.boundary.id} created`);setBoundaryOpen(false);refresh()}catch(error){notify(error.message,"error")}finally{setBusy(false)}};
  const toggleBoundary=async boundary=>{const status=boundary.status==="ACTIVE"?"INACTIVE":"ACTIVE";try{await api(`/api/geo-boundaries/${boundary.id}`,{method:"PATCH",body:JSON.stringify({status})});notify(`Boundary ${status.toLowerCase()}`);refresh()}catch(error){notify(error.message,"error")}};
  return <div className="content"><section className="card"><Header title="Franchise Management" sub={`Physical: Command → Hub → Center → Point · Digital: Nation → Region → Territory → Zone → Node · ${boundaries.length} configured boundaries`}/><div className="toolbar"><input aria-label="Search franchises" placeholder="Search franchise, owner or level" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter franchises by level" value={levelFilter} onChange={event=>setLevelFilter(event.target.value)}><option value="ALL">All levels</option>{["Point","Center","Hub","Command","Node","Zone","Territory","Region","Nation"].map(level=><option key={level} value={level}>{level}</option>)}</select><select aria-label="Filter franchises by status" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select><button className="secondary-btn" onClick={()=>setBoundaryOpen(true)}>+ Add Point Boundary</button><button className="primary-btn" onClick={()=>setOpen(true)}>+ Add Franchise</button></div><Table headers={["ID","Level","Name","Owner","Parent","Status","Actions"]} rows={visible.map(f=>[f.id,<span className="level-badge">{f.level}</span>,f.name,f.owner_id,franchises.find(parent=>parent.id===f.parent_id)?.name||f.parent_id||"—",<span className={`badge ${f.status==="ACTIVE"?"success":"muted"}`}>{f.status}</span>,<div className="button-row"><button className="secondary-btn" onClick={()=>setEdit({...f})}>Edit</button><button className="secondary-btn" onClick={()=>toggleStatus(f)}>{f.status==="ACTIVE"?"Deactivate":"Activate"}</button></div>])} empty="No franchises match these filters"/></section><section className="card"><Header title="Geo Boundary Versions" sub="Add a new version to revise polygon geometry; older versions can be deactivated"/><Table headers={["Boundary","Point","Version","Status","Actions"]} rows={boundaries.map(boundary=>[boundary.id,franchises.find(item=>item.id===boundary.franchise_id)?.name||boundary.franchise_id,boundary.version,<span className={`badge ${boundary.status==="ACTIVE"?"success":"muted"}`}>{boundary.status}</span>,<button className="secondary-btn" onClick={()=>toggleBoundary(boundary)}>{boundary.status==="ACTIVE"?"Deactivate":"Activate"}</button>])} empty="No polygon boundaries configured"/></section>{edit&&<Modal title="Edit franchise" close={()=>setEdit(null)}><form onSubmit={saveEdit}><Field label="Name" value={edit.name} set={value=>setEdit({...edit,name:value})}/><Field label="Owner ID" value={edit.owner_id} set={value=>setEdit({...edit,owner_id:value})}/><div className="snapshot-info"><div><span>Level</span><b>{edit.level}</b></div><div><span>Franchise ID</span><b>{edit.id}</b></div><div><span>Parent</span><b>{franchises.find(parent=>parent.id===edit.parent_id)?.name||edit.parent_id||"Top-level Command / Nation"}</b></div></div><button className="primary-btn" disabled={busy}>{busy?"Saving…":"Save changes"}</button></form></Modal>}{open&&<Modal title="Create Franchise" close={()=>setOpen(false)}><form onSubmit={submit}><label>Level</label><select value={form.level} onChange={e=>setForm({...form,level:e.target.value,parent_id:""})}>{["Point","Center","Hub","Command","Node","Zone","Territory","Region","Nation"].map(x=><option key={x}>{x}</option>)}</select><Field label="Name" value={form.name} set={v=>setForm({...form,name:v})}/><Field label="Owner ID" value={form.owner_id} set={v=>setForm({...form,owner_id:v})}/>{parentLevel&&<div><label>{parentLevel} parent{form.level==="Command"?" (optional)":""}</label><select required={form.level!=="Command"} value={form.parent_id} onChange={e=>setForm({...form,parent_id:e.target.value})}><option value="">Select active {parentLevel} or leave empty</option>{parents.map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></div>}<button className="primary-btn" disabled={busy}>{busy?"Saving...":"Create Franchise"}</button></form></Modal>}{boundaryOpen&&<Modal title="Add Point Geo Boundary" close={()=>setBoundaryOpen(false)}><form onSubmit={submitBoundary}><label>Point franchise</label><select required value={boundaryForm.franchise_id} onChange={e=>setBoundaryForm({...boundaryForm,franchise_id:e.target.value})}><option value="">Select an active Point</option>{franchises.filter(item=>item.level==="Point"&&item.status==="ACTIVE").map(item=><option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><Field label="Boundary version" value={boundaryForm.version} set={v=>setBoundaryForm({...boundaryForm,version:v})}/><label>GeoJSON polygon coordinates [longitude, latitude]</label><textarea rows="6" value={boundaryForm.coordinates} onChange={e=>setBoundaryForm({...boundaryForm,coordinates:e.target.value})}/><small>Rings must be closed. Coordinates are stored as a GeoJSON Polygon.</small><button className="primary-btn" disabled={busy}>{busy?"Saving...":"Create Boundary"}</button></form></Modal>}</div>;
}

function Orders({orders,users,refresh,notify,onManageLocations,serviceFilter}) {
  const customers=users.filter(user=>!user.role||user.role==="CUSTOMER");
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[services,setServices]=useState([]),[locations,setLocations]=useState([]),[locationsLoading,setLocationsLoading]=useState(false),[locationError,setLocationError]=useState(""),[form,setForm]=useState({customer_id:customers[0]?.id||"",service_id:"",location_id:"",mobile_number:"",operator:"",circle:"",amount:""});
  const visibleServices=services.filter(service=>serviceFilter?service.id===serviceFilter:service.id!==MOBILE_RECHARGE_SERVICE_ID);
  const visibleOrders=orders.filter(order=>serviceFilter?order.service_id===serviceFilter:order.service_id!==MOBILE_RECHARGE_SERVICE_ID);
  const isRechargePage=serviceFilter===MOBILE_RECHARGE_SERVICE_ID;
  const selectedService=visibleServices.find(service=>service.id===form.service_id);
  const eligibleLocations=locations.filter(isBookableLocation);
  useEffect(()=>{api("/api/services").then(result=>{const catalog=result.services||[];setServices(catalog);const pageServices=catalog.filter(service=>serviceFilter?service.id===serviceFilter:service.id!==MOBILE_RECHARGE_SERVICE_ID);setForm(current=>({...current,service_id:pageServices.some(service=>service.id===current.service_id)?current.service_id:pageServices[0]?.id||""}))}).catch(error=>notify(error.message,"error"))},[notify,serviceFilter]);
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{
      setLocationsLoading(true);
      setLocationError("");
      if(!form.customer_id){setLocations([]);setLocationsLoading(false);return;}
      api(`/api/locations/user/${encodeURIComponent(form.customer_id)}`)
        .then(async result=>{
          const saved=result.locations||[];
          const mapped=await Promise.allSettled(saved.map(async location=>{
            const response=await api(`/api/geo/franchise-map?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}&location_id=${encodeURIComponent(location.id)}`);
            return {...location,mapping:response.mapping};
          }));
          if(!active)return;
          const failures=mapped.filter(item=>item.status==="rejected");
          if(failures.length){
            setLocationError("Could not verify all saved locations against the active franchise boundaries. Refresh and try again.");
            setLocations([]);
            return;
          }
          const verified=mapped.map(item=>item.value);
          const bookable=verified.filter(isBookableLocation);
          setLocations(verified);
          setForm(current=>({...current,location_id:bookable.some(location=>location.id===current.location_id)?current.location_id:bookable[0]?.id||""}));
        })
        .catch(error=>{if(active)setLocationError(error.message||"Unable to load this customer's saved locations.");})
        .finally(()=>{if(active)setLocationsLoading(false);});
    },0);
    return()=>{active=false;clearTimeout(timer);};
  },[form.customer_id]);
  const create=async e=>{e.preventDefault();if(!eligibleLocations.some(location=>location.id===form.location_id))return;setBusy(true);try{const d=await api("/api/orders",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({customer_id:form.customer_id,service_id:form.service_id,location_id:form.location_id,...(selectedService?.pricing_type==="CUSTOMER_AMOUNT"?{mobile_number:form.mobile_number,operator:form.operator,circle:form.circle,amount:form.amount}:{})})});notify(d.duplicate?`Order ${d.order?.id||""} already exists`:`Booking ${d.order?.id||""} created`);setOpen(false);refresh()}catch(e){notify(e.message,"error")}finally{setBusy(false)}};
  const confirm=async id=>{try{const result=await api(`/api/orders/${id}/confirm`,{method:"POST"});notify(result.message);refresh()}catch(e){notify(e.message,"error")}};
  const emptyLocationMessage=locationsLoading?"Loading and checking saved locations…":locationError?locationError:locations.length===0?"This customer has no saved locations. Capture a location before creating an order.":eligibleLocations.length===0?"Saved locations exist, but none are mapped to an active franchise with GPS accuracy of 100 m or better.":"";
  return <div className="content"><section className="card"><Header title={isRechargePage?"Mobile Recharge":"Orders & Bookings"} sub={isRechargePage?"Recharge orders are listed separately from other service bookings. Demo only; no mobile operator is contacted.":"Bookings for configured services; mobile recharge is managed separately."}/>{isRechargePage&&<div className="booking-hint" role="note"><strong>Demo mode:</strong> Creating or completing a recharge here does not submit a telecom recharge or collect payment.</div>}{customers.length>0&&visibleServices.length>0&&<button className="primary-btn" onClick={()=>setOpen(true)}>{isRechargePage?"+ Create Recharge Order":"+ Create Order"}</button>}<Table headers={["Order ID","Customer","Service","Amount","Status",...(isRechargePage?["Recharge number","Operator","Circle"]:[]),"Action"]} rows={visibleOrders.map(o=>{const isDemoRecharge=o.details?.processing_mode==="DEMO";const isComplete=["CONFIRMED","DEMO_COMPLETED"].includes(o.status);return [o.id,users.find(user=>user.id===o.customer_id)?.name||o.customer_id,<span>{o.service_id}{!isRechargePage&&o.details?.mobile_number&&<small>{o.details.operator_name} · {o.details.mobile_number} · {o.details.circle}</small>}</span>,money(o.amount),<span className={`badge ${o.status==="CONFIRMED"?"success":"muted"}`}>{isDemoRecharge&&o.status==="CONFIRMED"?"DEMO_COMPLETED":o.status}{isDemoRecharge&&<small>No telecom recharge submitted.</small>}</span>,...(isRechargePage?[o.details?.mobile_number||"—",o.details?.operator_name||"—",o.details?.circle||"—"]:[]),!isComplete?<button className="secondary-btn" onClick={()=>confirm(o.id)}>{isDemoRecharge?"Complete demo flow":"Confirm & process"}</button>:"—"]})} empty={isRechargePage?"No recharge orders have been created yet.":"No service bookings match your franchise."}/></section>{open&&<Modal title={isRechargePage?"Create Demo Recharge Order":"Create Service Order"} close={()=>setOpen(false)}><form onSubmit={create}><label>Customer</label><select required value={form.customer_id} onChange={e=>{setLocations([]);setLocationError("");setLocationsLoading(true);setForm({...form,customer_id:e.target.value,location_id:""});}}>{customers.map(u=><option key={u.id} value={u.id}>{u.name} · {u.id}</option>)}</select>{!isRechargePage&&<><label>Service</label><select required value={form.service_id} onChange={e=>setForm({...form,service_id:e.target.value})}>{visibleServices.map(service=><option key={service.id} value={service.id}>{service.name} — ${money(service.amount)} demo price</option>)}</select></>}{selectedService?.pricing_type==="CUSTOMER_AMOUNT"&&<><label>Mobile number</label><input type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength="10" value={form.mobile_number} onChange={e=>setForm({...form,mobile_number:e.target.value.replace(/\D/g,"").slice(0,10)})} required/><label>Operator</label><select value={form.operator} onChange={e=>setForm({...form,operator:e.target.value})} required><option value="">Select operator</option>{selectedService.operators.map(operator=><option key={operator.id} value={operator.id}>{operator.name}</option>)}</select><label>Circle</label><select value={form.circle} onChange={e=>setForm({...form,circle:e.target.value})} required><option value="">Select circle</option>{selectedService.circles.map(circle=><option key={circle} value={circle}>{circle}</option>)}</select><label>Recharge amount (₹)</label><input type="number" min={selectedService.min_amount} max={selectedService.max_amount} step="1" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} required/><small>This is a demo order only; a live telecom provider is not connected.</small></>}<label>Saved service location</label><select required value={form.location_id} onChange={e=>setForm({...form,location_id:e.target.value})} disabled={locationsLoading||eligibleLocations.length===0}><option value="">{locationsLoading?"Checking locations…":eligibleLocations.length?"Select a mapped service location":"No eligible mapped location"}</option>{eligibleLocations.map(location=><option key={location.id} value={location.id}>{location.address||`${Number(location.lat).toFixed(4)}, ${Number(location.lon).toFixed(4)}`} · {location.mapping.point?.name||"Mapped franchise"} · accuracy {location.accuracy}m</option>)}</select>{emptyLocationMessage&&<div className={locationError?"error-state":"booking-hint"} role={locationError?"alert":undefined}>{emptyLocationMessage}{!locationsLoading&&!locationError&&<button type="button" className="inline-auth-link" onClick={()=>{setOpen(false);onManageLocations?.();}}>Open Location Management</button>}</div>}<small>Only active-franchise mapped locations with GPS accuracy of 100 m or better are eligible. Customer, amount and franchise attribution are validated by the backend.</small><button className="primary-btn" disabled={busy||locationsLoading||!form.location_id||!eligibleLocations.some(location=>location.id===form.location_id)||!selectedService}>{busy?"Creating…":isRechargePage?"Create demo recharge order":"Create order"}</button></form></Modal>}</div>;
}

function Attribution({franchises,orders,isAdmin}) {
  const [data,setData]=useState(null),[selectedId,setSelectedId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const f=id=>franchises.find(x=>x.id===id);
  useEffect(()=>{
    if(!selectedId)return undefined;
    let active=true;
    api(`/api/attributions/${selectedId}`).then(result=>{if(active)setData(result.attribution||result)}).catch(error=>{if(active){setData(null);setError(error.message)}});
    return()=>{active=false};
  },[selectedId]);
  const create=async()=>{setBusy(true);try{const d=await api("/api/attributions",{method:"POST",body:JSON.stringify({order_id:selectedId})});setData(d.attribution||d);setError("")}catch(e){setError(e.message)}finally{setBusy(false)}};
  const shownData=selectedId?data:null;
  const loading=Boolean(selectedId&&!shownData&&!error);
  const digitalLevels=["node","zone","territory","region","nation"].filter(level=>shownData?.[`${level}_id`]);
  return <div className="content"><section className="card"><Header title="Immutable Order Attribution" sub="Historical backend mapping snapshot" badge={shownData?"SNAPSHOT":"SELECT BOOKING"}/><label>Booking</label><select value={selectedId} onChange={event=>{setData(null);setError("");setSelectedId(event.target.value)}}><option value="">Select an order</option>{orders.map(order=><option key={order.id} value={order.id}>{order.id} · {order.customer_id} · {order.status}</option>)}</select>{loading?<Loading msg="Loading attribution..."/>:shownData?<><div className="attribution-flow"><ABox l="ORDER" v={shownData.order_id}/><i>→</i><ABox l="POINT" v={f(shownData.point_id)?.name||shownData.point_id}/><i>→</i><ABox l="CENTER" v={f(shownData.center_id)?.name||shownData.center_id}/><i>→</i><ABox l="HUB" v={f(shownData.hub_id)?.name||shownData.hub_id}/><i>→</i><ABox l="COMMAND" v={f(shownData.command_id)?.name||shownData.command_id}/></div>{digitalLevels.length>0&&<div className="digital-attribution"><strong>DIGITAL HIERARCHY</strong><div className="attribution-flow">{digitalLevels.map((level,index)=><div className="digital-attribution-item" key={level}>{index>0&&<i>→</i>}<ABox l={level.toUpperCase()} v={f(shownData[`${level}_id`])?.name||shownData[`${level}_id`]}/></div>)}</div></div>}<div className="snapshot-info"><div><span>Mapping Version</span><b>{shownData.mapping_version||"—"}</b></div><div><span>Coordinates</span><b>{shownData.coordinates?`${shownData.coordinates.lat}, ${shownData.coordinates.lon}`:"—"}</b></div><div><span>Attributed At</span><b>{dateText(shownData.attributed_at)}</b></div></div><div className="success-state">IMMUTABLE SNAPSHOT — historical mapping is preserved.</div></>:<div className="empty-state"><div className="empty-icon">!</div><h3>{selectedId?"No attribution snapshot":"Choose a booking"}</h3><p>{error||"Attribution is created during staff confirmation."}</p>{isAdmin&&selectedId&&!error.includes("outside your assigned")&&<button className="primary-btn" onClick={create} disabled={busy}>{busy?"Creating...":"Create Attribution"}</button>}</div>}</section></div>;
}

function Commissions({commissions,refresh,notify,isAdmin}) {
  const [rules,setRules]=useState([]),[services,setServices]=useState([]),[showRule,setShowRule]=useState(false),[busy,setBusy]=useState(false),[level,setLevel]=useState("Point"),[rule,setRule]=useState({service_id:"",rate:"",type:"percentage",effective_from:new Date().toISOString().slice(0,10),effective_to:"",version:"v1"});
  const levels=["Point","Center","Hub","Command"];
  const total=commissions.reduce((s,x)=>s+Number(x.amount||0),0);
  useEffect(()=>{Promise.all([api("/api/commissions/rules"),api("/api/services")]).then(([rulesResult,serviceResult])=>{setRules(rulesResult.rules||[]);const catalog=serviceResult.services||[];setServices(catalog);setRule(current=>({...current,service_id:current.service_id||catalog[0]?.id||""}))}).catch(error=>notify(error.message,"error"))},[notify]);
  const transition=async(entry,action)=>{
    let body;
    if(action==="reverse"){
      const reason=window.prompt("Enter a reason for reversing this commission (10-500 characters):");
      if(reason===null)return;
      body={reason};
    }
    try{
      const result=await api(`/api/commissions/${encodeURIComponent(entry.id)}/${action}`,{method:"POST",...(body?{body:JSON.stringify(body)}:{})});
      notify(result.message||`Commission ${action} completed`);
      refresh();
    }catch(error){notify(error.message,"error")}
  };
  const lifecycleActions=entry=>{
    if(!isAdmin)return "—";
    const status=entry.lifecycle_status||(entry.settlement_status==="SETTLED"?"SETTLED":String(entry.status||"CALCULATED").toUpperCase());
    if(status==="CALCULATED")return <div className="button-row"><button className="secondary-btn" onClick={()=>transition(entry,"eligible")}>Mark eligible</button><button className="secondary-btn" onClick={()=>transition(entry,"reverse")}>Reverse</button></div>;
    if(status==="ELIGIBLE")return <div className="button-row"><button className="secondary-btn" onClick={()=>transition(entry,"approve")}>Approve</button><button className="secondary-btn" onClick={()=>transition(entry,"reverse")}>Reverse</button></div>;
    if(status==="APPROVED")return <div className="button-row"><button className="secondary-btn" onClick={()=>transition(entry,"settle")}>Settle</button><button className="secondary-btn" onClick={()=>transition(entry,"reverse")}>Reverse</button></div>;
    if(status==="SETTLED")return <button className="secondary-btn" onClick={()=>transition(entry,"reverse")}>Reverse payout</button>;
    return "—";
  };
  const saveRule=async event=>{event.preventDefault();setBusy(true);try{const result=await api("/api/commissions/rules",{method:"POST",body:JSON.stringify({...rule,effective_to:rule.effective_to||null,level,rate:Number(rule.rate),status:"ACTIVE"})});setRules(current=>[result.rule,...current]);setShowRule(false);notify("Commission rule created")}catch(error){notify(error.message,"error")}finally{setBusy(false)}};
  return <div className="content"><section className="card"><Header title="Commission Ledger" sub="Calculated → Eligible → Approved → Settled; authorized admins can reverse with an audited reason." badge="CONFIGURATION DRIVEN"/><div className="commission-grid">{levels.map(currentLevel=>{const entries=commissions.filter(entry=>entry.level===currentLevel);const amount=entries.reduce((sum,entry)=>sum+Number(entry.amount||0),0);return <div className="commission-card" key={currentLevel}><span>{currentLevel} Commission</span><strong>{money(amount)}</strong><small>{entries.length} ledger entries</small></div>})}</div><div className="commission-status"><div><span>Calculation</span><b>{commissions.length?commissions.every(entry=>entry.calculation_status==="Calculated")?"Calculated":"In progress":"Pending"}</b></div><div><span>Settlement</span><b>{commissions.length&&commissions.every(entry=>entry.settlement_status==="SETTLED")?"Settled":"Pending"}</b></div><div><span>Total</span><b>{money(total)}</b></div></div><Table headers={["Ledger ID","Order","Level","Rule version","Amount","Calculation","Lifecycle","Settlement","Action"]} rows={commissions.map(entry=>[entry.id,entry.order_id,entry.level,entry.rule_version||entry.rule_id,money(entry.amount),entry.calculation_status||entry.status,entry.lifecycle_status||(entry.settlement_status==="SETTLED"?"SETTLED":String(entry.status||"CALCULATED").toUpperCase()),entry.settlement_status||"Pending",lifecycleActions(entry)])} empty="No commission entries in this ledger"/><button className="secondary-btn" onClick={refresh}>Refresh Commission Ledger</button></section><section className="card"><Header title="Commission Rules" sub={`${rules.length} versioned rules · test configuration`}/>{isAdmin&&<button className="primary-btn" onClick={()=>setShowRule(value=>!value)}>{showRule?"Cancel":"Add rule version"}</button>}<Table headers={["Rule","Service","Level","Rate","Effective from","Effective to","Version","Status"]} rows={rules.map(item=>[item.rule_id,item.service_id,item.level,item.type==="percentage"?`${item.rate}%`:money(item.rate),dateText(item.effective_from),item.effective_to?dateText(item.effective_to):"No end date",item.version,item.status])} empty="No commission rules configured"/>{showRule&&<form className="staff-form" onSubmit={saveRule}><div className="form-grid"><div><label>Service</label><select required value={rule.service_id} onChange={event=>setRule({...rule,service_id:event.target.value})}>{services.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></div><div><label>Franchise level</label><select value={level} onChange={event=>setLevel(event.target.value)}>{levels.map(item=><option key={item}>{item}</option>)}</select></div><div><label>Rate type</label><select value={rule.type} onChange={event=>setRule({...rule,type:event.target.value})}><option value="percentage">Percentage</option><option value="fixed">Fixed ₹</option></select></div><Field label="Rate" type="number" value={rule.rate} set={value=>setRule({...rule,rate:value})}/><Field label="Effective from" type="date" value={rule.effective_from} set={value=>setRule({...rule,effective_from:value})}/><Field label="Effective to (optional)" type="date" value={rule.effective_to} set={value=>setRule({...rule,effective_to:value})}/><Field label="Version" value={rule.version} set={value=>setRule({...rule,version:value})}/></div><button className="primary-btn" disabled={busy}>{busy?"Saving…":"Create active rule"}</button></form>}</section></div>;
}

function Wallet({session,franchises,notify}) {
  const ownerOptions=franchises.filter(franchise=>franchise.owner_id).map(franchise=>({id:franchise.owner_id,label:`${franchise.name} · ${franchise.level}`}));
  const [selectedOwner,setSelectedOwner]=useState(session.role==="ADMIN"?"":session.id);
  const [wallet,setWallet]=useState(null),[commissions,setCommissions]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=useCallback(async()=>{
    if(!selectedOwner){setWallet(null);setCommissions([]);return;}
    setBusy(true);setError("");
    try {
      const walletPath=session.role==="ADMIN"?`/api/wallet?owner_id=${encodeURIComponent(selectedOwner)}`:"/api/wallet";
      const [walletResult,commissionResult]=await Promise.all([
        api(walletPath),
        api(`/api/commissions/${encodeURIComponent(selectedOwner)}`)
      ]);
      setWallet(walletResult.wallet);
      setCommissions(commissionResult.commissions||[]);
    } catch(problem) {
      setError(problem.message||"Unable to load the wallet ledger.");
      notify(problem.message||"Unable to load the wallet ledger.","error");
    } finally {setBusy(false);}
  },[notify,selectedOwner,session.role]);
  useEffect(()=>{const timer=setTimeout(()=>{load();},0);return()=>clearTimeout(timer);},[load]);
  return <div className="content"><section className="card"><Header title="Wallet & Owner Ledger" sub="Settled credits, reversal debits and each commission lifecycle state are recorded"/>{session.role==="ADMIN"&&<div className="form-grid"><div><label htmlFor="wallet-owner">Franchise owner</label><select id="wallet-owner" value={selectedOwner} onChange={event=>setSelectedOwner(event.target.value)}><option value="">Select an owner</option>{ownerOptions.map((owner,index)=><option key={`${owner.id}-${index}`} value={owner.id}>{owner.label} · {owner.id}</option>)}</select></div></div>}{error&&<div className="error-state" role="alert">{error}</div>}{busy?<Loading msg="Loading owner wallet…"/>:wallet?<><div className="report-grid"><div><span>Available balance</span><b>{money(wallet.balance)}</b></div><div><span>Total credits</span><b>{money(wallet.credits)}</b></div><div><span>Total debits</span><b>{money(wallet.debits)}</b></div><div><span>Wallet entries</span><b>{wallet.count}</b></div></div><Table headers={["Date","Entry","Reference","Amount","Status"]} rows={wallet.entries.map(entry=>[dateText(entry.created_at),entry.entry.toUpperCase(),entry.reference,money(entry.amount),entry.status])} empty="No wallet entries yet"/><h3>Commission lifecycle</h3><Table headers={["Order","Level","Calculation","Lifecycle","Settlement","Amount","Rule"]} rows={commissions.map(entry=>[entry.order_id,entry.level,entry.calculation_status||entry.status,entry.lifecycle_status||(entry.settlement_status==="SETTLED"?"SETTLED":String(entry.status||"CALCULATED").toUpperCase()),entry.settlement_status||"Pending",money(entry.amount),entry.rule_version||entry.rule_id])} empty="No commission entries for this owner"/></>:selectedOwner?<EmptyState title="Wallet unavailable" message="The owner wallet could not be loaded."/>:<EmptyState title="Choose a franchise owner" message="Select an owner to view their settled wallet and commission lifecycle."/>}</section><section className="card"><button className="secondary-btn" onClick={load} disabled={busy}>Refresh wallet</button></section></div>;
}

function Reports({users,orders,boundaries}) {
  const [dates,setDates]=useState({start:"",end:""}),[report,setReport]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const loadReport=useCallback(async()=>{if(dates.start&&dates.end&&dates.start>dates.end){setError("From date cannot be later than To date.");return;}setBusy(true);setError("");try{const query=new URLSearchParams();if(dates.start)query.set("start_date",dates.start);if(dates.end)query.set("end_date",dates.end);const result=await api(`/api/reports/commissions?${query.toString()}`);setReport(result)}catch(problem){setError(problem.message)}finally{setBusy(false)}},[dates]);
  useEffect(()=>{const timer=setTimeout(loadReport,0);return()=>clearTimeout(timer)},[loadReport]);
  const rows=(report?.by_level||["Point","Center","Hub","Command"].map(level=>({level,count:0,total:0,settled_total:0,pending_total:0}))).map(item=>[item.level,item.count,money(item.total),money(item.settled_total),money(item.pending_total)]);
  const maximum=Math.max(1,...(report?.by_level||[]).map(item=>item.total));
  return <div className="content"><section className="card"><Header title="Reports & Analytics" sub="Backend-generated commission totals by date, franchise level, and settlement state"/><div className="form-grid"><Field label="From date" type="date" value={dates.start} set={value=>setDates({...dates,start:value})}/><Field label="To date" type="date" value={dates.end} set={value=>setDates({...dates,end:value})}/><button className="primary-btn" onClick={loadReport} disabled={busy}>{busy?"Loading…":"Run report"}</button></div>{error&&<div className="error-state" role="alert">{error}</div>}{busy?<Loading msg="Loading commission report…"/>:<><div className="report-grid"><div><span>Customers</span><b>{users.length}</b></div><div><span>Orders</span><b>{orders.length}</b></div><div><span>Boundaries</span><b>{boundaries.length}</b></div><div><span>Commission Entries</span><b>{report?.count??"—"}</b></div><div><span>Commission Total</span><b>{money(report?.total)}</b></div><div><span>Settled Total</span><b>{money(report?.settled_total)}</b></div><div><span>Pending Total</span><b>{money(report?.pending_total)}</b></div></div><h3>Commission by Level</h3><div className="report-chart" role="img" aria-label="Commission totals by franchise level">{(report?.by_level||[]).map(item=><div className="report-chart-row" key={item.level}><span>{item.level}</span><div className="report-chart-track"><div className="report-chart-fill" style={{width:`${Math.max(item.total?2:0,item.total/maximum*100)}%`}}/></div><b>{money(item.total)}</b></div>)}</div><Table headers={["Level","Entries","Total","Settled","Pending"]} rows={rows}/></>}<button className="secondary-btn" onClick={()=>window.print()}>Print / Export Report</button></section></div>;
}

function AuditLogs({logs}) {
  return <div className="content"><section className="card"><Header title="Audit & Security" sub="Traceability of sensitive operations"/>{logs.length?<Table headers={["Timestamp","Actor","Action","Entity","Result"]} rows={logs.map(x=>[dateText(x.timestamp||x.created_at),x.actor||x.actor_id,x.action,x.entity,x.result||"Recorded"])}/>:<EmptyState title="No audit logs loaded" message="The audit API will populate this view when sensitive actions are recorded."/>}</section></div>;
}

function LiveLocationMap({coordinates,points}) {
  return coordinates
    ? <Map lat={coordinates.lat} lon={coordinates.lon} accuracy={coordinates.accuracy} points={points} mapped/>
    : <div className="live-map-placeholder">GPS position appears on the map when tracking starts.</div>;
}

function MapViewport({center}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 15), { animate: false });
  }, [center, map]);
  return null;
}

function Map({lat,lon,mapped,accuracy,points=[],boundaryGeometry,boundaryId}) {
  const center = [Number(lat), Number(lon)];
  const trail = points.map(point => [Number(point.lat), Number(point.lon)]);
  return <div className="map-box" role="region" aria-label={`Interactive map centered at ${center[0].toFixed(5)}, ${center[1].toFixed(5)}`}>
    <MapContainer center={center} zoom={15} scrollWheelZoom className="interactive-map">
      <MapViewport center={center}/>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {boundaryGeometry && <GeoJSON key={boundaryId} data={boundaryGeometry} style={{ color: "#18754b", weight: 3, fillColor: "#4f9b6d", fillOpacity: 0.16 }}/>}
      {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: "#18754b", weight: 4, opacity: 0.8 }}/>}
      {Number(accuracy) > 0 && <Circle center={center} radius={Number(accuracy)} pathOptions={{ color: "#28784c", fillColor: "#4f9b6d", fillOpacity: 0.14 }}/>}
      <Marker position={center} icon={locationIcon}>
        <Popup>{mapped ? "Mapped service location" : "Saved location"}<br/>{center[0].toFixed(5)}, {center[1].toFixed(5)}</Popup>
      </Marker>
    </MapContainer>
  </div>;
}
function Stat({title,value,sub}){return <div className="stat-card"><span>{title}</span><strong>{value}</strong><small>{sub}</small></div>;}
function Header({title,sub,badge}){return <div className="card-header"><div><h3>{title}</h3>{sub&&<p>{sub}</p>}</div>{badge&&<span className="badge success">{badge}</span>}</div>;}
function HItem({level,item}){return <div className="hierarchy-item"><div className="level-icon">{level[0]}</div><div><span>{level}</span><strong>{item?.name||"Not configured"}</strong></div><small>{item?.owner_id||"—"}</small></div>;}
function FlowStep({n,text}){return <div className="flow-step"><div className="flow-number">{String(n).padStart(2,"0")}</div><span>{text}</span></div>;}
function FlowArrow(){return <div className="flow-arrow">→</div>;}
function ABox({l,v}){return <div className="attribute-box"><span>{l}</span><strong>{v||"—"}</strong></div>;}
function Field({label,value,set,type="text"}){return <div><label>{label}</label><input type={type} value={value} onChange={e=>set(e.target.value)} required/></div>;}
function Modal({title,close,children}){return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><h3>{title}</h3><button className="secondary-btn" onClick={close}>Close</button></div>{children}</div></div>;}
function Loading({msg}){return <div className="empty-state"><div className="empty-icon">...</div><h3>Loading</h3><p>{msg}</p></div>;}
function EmptyState({title,message}){return <div className="empty-state"><div className="empty-icon">—</div><h3>{title}</h3><p>{message}</p></div>;}
function Table({headers,rows,empty}){if(!rows.length)return <EmptyState title={empty||"No data"} message="No records are currently available."/>;return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;}

export default App;

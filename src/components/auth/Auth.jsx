/* components/auth/Auth.jsx — entrar, criar conta, recuperar senha e definir senha nova. */
import React, { useState } from "react";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Logo } from "../common/Logo";
import { sb } from "../../services/supabaseService";

/* =========================== TELA DE LOGIN =========================== */
function Auth(){
  const [signup,setSignup]=useState(false);
  const [recoverMode,setRecoverMode]=useState(false);
  const [recoverSent,setRecoverSent]=useState(false);
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [err,setErr]=useState("");
  const [ok,setOk]=useState("");
  const [busy,setBusy]=useState(false);
  async function go(){
    setErr(""); setOk(""); setBusy(true);
    try{
      if(signup){
        const { error } = await sb.auth.signUp({ email, password:pass, options:{ emailRedirectTo: window.location.origin+window.location.pathname } });
        if(error) throw error;
        setOk("Conta criada. Se pedirem confirmação, verifique seu e-mail — o link te traz de volta aqui já conectado.");
        setSignup(false);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password:pass });
        if(error) throw error;
      }
    }catch(e){ setErr(e.message||"Não foi possível continuar."); }
    finally{ setBusy(false); }
  }
  async function sendRecovery(){
    setErr(""); setBusy(true);
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin+window.location.pathname });
      if(error) throw error;
      setRecoverSent(true);
    }catch(e){ setErr(e.message||"Não foi possível enviar o link de redefinição."); }
    finally{ setBusy(false); }
  }
  function backToLogin(){ setRecoverMode(false); setRecoverSent(false); setErr(""); setOk(""); }
  return (
    <div className="rz dark">
      <div className="authshell">
        <div className="authbrand">
          <h1 className="mark"><Logo variant="vertical" height={112}/></h1>
          <p>Clareza total sobre para onde vai cada real.</p>
          <ul className="authbadges">
            <li><Icon name="escudo" size={16}/> Dados protegidos pelo Supabase</li>
            <li><Icon name="baixar" size={16}/> Backup exportável a qualquer momento</li>
            <li><Icon name="cartao" size={16}/> Funciona no computador e no celular</li>
          </ul>
        </div>
        <div className="authform">
          {recoverMode ? (
            <div className="authformcard">
              <h2>Redefinir senha</h2>
              {recoverSent ? (
                <React.Fragment>
                  <div className="fieldok" style={{marginBottom:16}}>Enviamos um link de redefinição para {email}. Abra-o neste aparelho para definir uma nova senha.</div>
                  <button className="sbtn" onClick={backToLogin}>Voltar para entrar</button>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <p style={{fontSize:13,color:"var(--text-mut)",marginBottom:14}}>Informe seu e-mail — enviaremos um link para você criar uma nova senha.</p>
                  <div className="field">
                    <input id="recoveremail" className="fld floating" type="email" placeholder=" " value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendRecovery();}} />
                    <label htmlFor="recoveremail">E-mail</label>
                  </div>
                  <button className="submit" onClick={sendRecovery} disabled={busy||!email}>{busy?"Enviando…":"Enviar link de redefinição"}</button>
                  {err && <div className="fielderr">{err}</div>}
                  <div className="authswitch"><button onClick={backToLogin}>Voltar para entrar</button></div>
                </React.Fragment>
              )}
            </div>
          ) : (
            <div className="authformcard">
              <h2>{signup?"Criar conta":"Entrar"}</h2>
              <div className="field">
                <input id="authemail" className="fld floating" type="email" placeholder=" " value={email} onChange={e=>setEmail(e.target.value)} />
                <label htmlFor="authemail">E-mail</label>
              </div>
              <div className="field">
                <input id="authpass" className="fld floating" type={showPass?"text":"password"} placeholder=" " value={pass}
                  onChange={e=>setPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")go();}} />
                <label htmlFor="authpass">Senha (mínimo 6 caracteres)</label>
                <button type="button" className="fieldicon" aria-label={showPass?"Ocultar senha":"Mostrar senha"} onClick={()=>setShowPass(s=>!s)}>
                  <Icon name={showPass?"olho-fechado":"olho"} size={16}/>
                </button>
              </div>
              {!signup &&
                <div style={{textAlign:"right",marginBottom:14,marginTop:-8}}>
                  <button type="button" style={{border:"none",background:"none",color:"var(--text-mut)",cursor:"pointer",fontSize:12,textDecoration:"underline"}} onClick={()=>{setRecoverMode(true);setErr("");}}>Esqueci minha senha</button>
                </div>}
              <button className="submit" onClick={go} disabled={busy||!email||pass.length<6}>
                {busy?"Enviando…":signup?"Criar conta":"Entrar"}
              </button>
              {err && <div className="fielderr">{err}</div>}
              {ok && <div className="fieldok">{ok}</div>}
              <div className="authswitch">
                {signup ? <>Já tem conta? <button onClick={()=>{setSignup(false);setErr("");}}>Entrar</button></>
                        : <>Novo por aqui? <button onClick={()=>{setSignup(true);setErr("");}}>Criar conta</button></>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
/* =========================== DEFINIR NOVA SENHA (link de recuperação) =========================== */
function RecoverySetPassword({ onDone }){
  const [pass,setPass]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  async function save(){
    setErr(""); setBusy(true);
    try{
      const { error } = await sb.auth.updateUser({ password: pass });
      if(error) throw error;
      toast("Senha atualizada.","success");
      onDone();
    }catch(e){ setErr(e.message||"Não foi possível atualizar a senha."); }
    finally{ setBusy(false); }
  }
  return (
    <div className="rz dark">
      <div className="authshell">
        <div className="authbrand">
          <h1 className="mark"><Logo variant="vertical" height={112}/></h1>
          <p>Vamos definir sua nova senha.</p>
        </div>
        <div className="authform">
          <div className="authformcard">
            <h2>Nova senha</h2>
            <div className="field">
              <input id="recoverpass" className="fld floating" type={showPass?"text":"password"} placeholder=" " value={pass}
                onChange={e=>setPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}} />
              <label htmlFor="recoverpass">Nova senha (mínimo 6 caracteres)</label>
              <button type="button" className="fieldicon" aria-label={showPass?"Ocultar senha":"Mostrar senha"} onClick={()=>setShowPass(s=>!s)}>
                <Icon name={showPass?"olho-fechado":"olho"} size={16}/>
              </button>
            </div>
            <button className="submit" onClick={save} disabled={busy||pass.length<6}>{busy?"Salvando…":"Salvar nova senha"}</button>
            {err && <div className="fielderr">{err}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { Auth, RecoverySetPassword };

export function publicWebUrl(value) {
  if(typeof value!=='string'||value.length>8192)throw new Error('Invalid public web URL');
  const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!host.includes('.')||/[:\[\]]/.test(host)||/^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host))throw new Error('Only public web URLs are supported');
  return u.href.replace(/[()<>\[\]\\]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
}

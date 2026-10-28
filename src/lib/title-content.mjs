export const TITLE_SCHEMA={type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false};
export function validateTitle(value,locale='zh') {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='title'||typeof value.title!=='string')throw new Error('Invalid title response');
  const title=value.title.trim(),length=[...title].length;
  if(length<2||length>(locale==='en'?60:32)||/[\r\n<>]/.test(title)||/sk-[\w-]{8,}|\d{7,}/i.test(title))throw new Error('Invalid title content');
  return title;
}

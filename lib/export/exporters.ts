export function exportJSON(data:any){
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}))
  const a = document.createElement('a'); a.href=url; a.download='analysis.json'; a.click()
}

(function(){"use strict";if(window.__dewsecureInjected)return;window.__dewsecureInjected=!0;let e=document.createElement("script"),c=`_0x${(Date.now()&4294967295).toString(16)}`;e.textContent=`
(function() {
    const ${c} = {
        adBlock: false, adblock: false, adsBlocked: 0,
        isAdBlockActive: false, canRunAds: true, canShowAds: true
    };
    const props = ['adBlock','adblock','adsBlocked','isAdBlockActive','canRunAds','canShowAds'];
    for (const p of props) {
        try { Object.defineProperty(window, p, { get: () => ${c}[p], configurable: true }); } catch(e) {}
    }
})();
`,(document.head||document.documentElement).insertBefore(e,(document.head||document.documentElement).firstChild),e.remove();let d=['[class*="ad-"]','[class*="ads-"]','[class*="advert"]','[id*="ad-"]','[id*="ads-"]','[id*="advert"]','[class*="banner"]','[class*="popup"]','[class*="sponsor"]','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]'];function t(){for(let s of d)try{document.querySelectorAll(s).forEach(n=>{let o=n.getBoundingClientRect();o.width<10||o.height<10||n.style.setProperty("display","none","important")})}catch{}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",t):t(),new MutationObserver(t).observe(document.documentElement,{childList:!0,subtree:!0})})();

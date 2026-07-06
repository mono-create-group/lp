
(function(){
  var hd = document.getElementById('hd');
  addEventListener('scroll', function(){
    hd.classList.toggle('solid', scrollY > 40);
  }, {passive:true});
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('on'); io.unobserve(e.target); } });
  }, {threshold:.15});
  document.querySelectorAll('.fade').forEach(function(el){ io.observe(el); });
})();
